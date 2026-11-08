// Lee los canales de Discord y guarda el feedback en D1.
// El plan gratis de Workers permite ~50 llamadas externas por ejecución,
// así que cada corrida tiene un presupuesto y la carga histórica sigue en la próxima.

import { messageToItem, isSkippable, deriveFields } from './parse.js';

const API = 'https://discord.com/api/v10';
// ~50 llamadas por corrida en el plan gratis: Discord usa hasta 34 y lo que sobra va a la IA.
export const BUDGET = 34;

class Discord {
  constructor(token, base = API) {
    this.token = token;
    this.base = base;
    this.calls = 0;
  }
  get left() {
    return BUDGET - this.calls;
  }
  async get(path) {
    if (this.calls >= BUDGET) throw new BudgetError();
    this.calls++;
    const res = await fetch(this.base + path, { headers: { Authorization: `Bot ${this.token}` } });
    if (res.status === 429) throw new BudgetError('rate limit');
    if (res.status === 403 || res.status === 404) return null; // sin acceso a ese canal
    if (!res.ok) throw new Error(`Discord ${res.status} ${path}: ${await res.text()}`);
    return res.json();
  }
}
class BudgetError extends Error {}

async function getCursor(db, key) {
  const row = await db.prepare('SELECT value FROM cursors WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
async function setCursor(db, key, value) {
  await db.prepare('INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

const UPSERT = `INSERT INTO items (id, source, channel_id, thread_id, url, author_id, author_name, title, content, fields, attachments,
  forum_tags, build, context, mode, submission_id, reactions, replies, created_at, auto_category, systems, liked, voice)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, fields = excluded.fields,
    attachments = excluded.attachments, forum_tags = excluded.forum_tags, reactions = excluded.reactions,
    replies = MAX(items.replies, excluded.replies), liked = excluded.liked,
    -- Si el texto no cambió, se queda lo que decidió la IA; si cambió, se vuelve a clasificar.
    auto_category = CASE WHEN items.content IS excluded.content AND items.title IS excluded.title AND items.ai_at IS NOT NULL THEN items.auto_category ELSE excluded.auto_category END,
    systems = CASE WHEN items.systems_by_team = 1 OR (items.content IS excluded.content AND items.title IS excluded.title AND items.ai_at IS NOT NULL) THEN items.systems ELSE excluded.systems END,
    voice = CASE WHEN items.content IS excluded.content AND items.title IS excluded.title AND items.ai_at IS NOT NULL THEN items.voice ELSE excluded.voice END,
    ai_at = CASE WHEN items.content IS excluded.content AND items.title IS excluded.title THEN items.ai_at ELSE NULL END`;

function upsertStmt(db, it) {
  return db.prepare(UPSERT).bind(
    it.id, it.source, it.channel_id, it.thread_id, it.url, it.author_id, it.author_name, it.title, it.content,
    JSON.stringify(it.fields), JSON.stringify(it.attachments), JSON.stringify(it.forum_tags), it.build, it.context,
    it.mode, it.submission_id, it.reactions, it.replies, it.created_at, it.auto_category, JSON.stringify(it.systems || []), it.liked || null, JSON.stringify(it.voice || {}),
  );
}

// Discord convierte los mensajes muy largos en un archivo message.txt: se lee y se usa como texto.
const isTextFile = (a) => /\.txt$/i.test(a.name || '') || /^text\/plain/i.test(a.type || '');
async function readTextFile(dc, url) {
  if (dc.left <= 2) return null;
  dc.calls++;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.text()).slice(0, 8000);
}
async function fillTextAttachment(db, dc, it) {
  const file = (it.attachments || []).find(isTextFile);
  if (!file) return it;
  const known = await db.prepare('SELECT content FROM items WHERE id = ?').bind(it.id).first();
  let text = known?.content && known.content !== it.content ? known.content : null;
  if (!text) {
    const body = await readTextFile(dc, file.url).catch(() => null);
    if (body) text = [it.content, body].filter((x) => x && x.trim()).join('\n\n');
  }
  if (text) { it.content = text; deriveFields(it); }
  return it;
}

// Mensajes viejos que ya estaban guardados sin leer su message.txt (pocos por corrida).
export async function repairTextAttachments(env, db, dc, { force = false } = {}) {
  // Recorre la tabla, así que corre una vez por hora y no cada 5 minutos.
  if (!force && new Date().getUTCMinutes() >= 5) return 0;
  const rows = await db.prepare(`SELECT id, channel_id, thread_id, content, attachments FROM items
    WHERE (content IS NULL OR TRIM(content) = '') AND attachments LIKE '%.txt%'
    AND ('txtfail:' || id) NOT IN (SELECT key FROM cursors) ORDER BY created_at DESC LIMIT 3`).all();
  let fixed = 0;
  for (const r of rows.results) {
    if (dc.left <= 4) break;
    const msg = await dc.get(r.thread_id ? `/channels/${r.thread_id}/messages/${r.thread_id}` : `/channels/${r.channel_id}/messages/${r.id}`);
    const file = (msg?.attachments || []).find((a) => isTextFile({ name: a.filename, type: a.content_type }));
    const body = file ? await readTextFile(dc, file.url).catch(() => null) : null;
    if (!body) { await setCursor(db, `txtfail:${r.id}`, '1'); continue; }
    const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind(r.id).first();
    const it = { ...row, fields: JSON.parse(row.fields || '[]'), attachments: JSON.parse(row.attachments || '[]'), forum_tags: JSON.parse(row.forum_tags || '[]') };
    it.content = [msg.content, body].filter((x) => x && x.trim()).join('\n\n');
    deriveFields(it);
    await db.prepare('UPDATE items SET content = ?, auto_category = ?, systems = CASE WHEN systems_by_team = 1 THEN systems ELSE ? END, voice = ?, ai_at = NULL WHERE id = ?')
      .bind(it.content, it.auto_category, JSON.stringify(it.systems || []), JSON.stringify(it.voice || {}), r.id).run();
    fixed++;
  }
  return fixed;
}

// Guarda una tanda de mensajes de un canal de texto.
async function storeMessages(env, db, messages, channelId, source, dc) {
  const stmts = [];
  const ids = new Set(messages.map((m) => m.id));
  // Las respuestas a otro mensaje se guardan como comentario del original.
  const replyTargets = messages
    .filter((m) => m.type === 19 && m.message_reference?.message_id)
    .map((m) => m.message_reference.message_id);
  const known = new Set();
  // Envíos que todavía están como fila de la planilla (rango por id: usa el índice, no recorre la tabla).
  const sheetSubs = new Set();
  if (messages.some((m) => m.embeds?.length)) {
    const sr = await db.prepare("SELECT submission_id FROM items WHERE id >= 'sheet:' AND id < 'sheet;' AND submission_id IS NOT NULL").all();
    sr.results.forEach((r) => sheetSubs.add(r.submission_id));
  }
  // Lo que ya está guardado: si no cambió nada, no se vuelve a escribir (cada corrida relee los últimos 100 mensajes).
  const stored = new Map();
  const seenComments = new Set();
  const idList = [...ids];
  for (let i = 0; i < idList.length; i += 90) {
    const chunk = idList.slice(i, i + 90);
    const marks = chunk.map(() => '?').join(',');
    const r1 = await db.prepare(`SELECT id, title, content, reactions FROM items WHERE id IN (${marks})`).bind(...chunk).all();
    r1.results.forEach((r) => stored.set(r.id, r));
    const r2 = await db.prepare(`SELECT id FROM comments WHERE id IN (${marks})`).bind(...chunk).all();
    r2.results.forEach((r) => seenComments.add(r.id));
  }
  if (replyTargets.length) {
    const q = `SELECT id FROM items WHERE id IN (${replyTargets.map(() => '?').join(',')})`;
    const rows = await db.prepare(q).bind(...replyTargets).all();
    rows.results.forEach((r) => known.add(r.id));
  }
  for (const m of messages) {
    if (isSkippable(m, env.DISCORD_CLIENT_ID)) continue;
    const parent = m.type === 19 ? m.message_reference?.message_id : null;
    if (parent && (known.has(parent) || ids.has(parent)) && !m.author?.bot) {
      if (seenComments.has(m.id)) continue;
      stmts.push(
        db.prepare('INSERT OR IGNORE INTO comments (id, item_id, author_name, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(m.id, parent, m.author?.global_name || m.author?.username, m.content, m.timestamp),
      );
      stmts.push(db.prepare('UPDATE items SET replies = (SELECT COUNT(*) FROM comments WHERE item_id = ?1) WHERE id = ?1').bind(parent));
      continue;
    }
    const it = messageToItem(m, { guildId: env.GUILD_ID, channelId, source });
    const old = stored.get(it.id);
    const hasTxt = (it.attachments || []).some(isTextFile);
    if (old && old.title === (it.title ?? null) && old.reactions === it.reactions
      && (old.content === it.content || (hasTxt && old.content))) continue; // sin cambios
    await fillTextAttachment(db, dc, it);
    stmts.push(upsertStmt(db, it));
    // Si este envío ya estaba importado desde la planilla, se queda la versión de Discord.
    // Antes esto recorría la tabla entera por cada mensaje en cada corrida (millones de lecturas al día).
    if (it.submission_id && sheetSubs.has(it.submission_id)) {
      sheetSubs.delete(it.submission_id);
      stmts.push(db.prepare("UPDATE items SET duplicate_of = ?1 WHERE duplicate_of IN (SELECT id FROM items WHERE id >= 'sheet:' AND id < 'sheet;' AND submission_id = ?2)").bind(it.id, it.submission_id));
      stmts.push(db.prepare("DELETE FROM items WHERE id >= 'sheet:' AND id < 'sheet;' AND submission_id = ?").bind(it.submission_id));
    }
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

async function syncTextChannel(env, db, dc, channelId, source) {
  let saved = 0;
  // 1) Lo más nuevo: siempre se relee la última página (actualiza reacciones).
  const latestKey = `latest:${channelId}`;
  let after = await getCursor(db, latestKey);
  if (!after) {
    const page = await dc.get(`/channels/${channelId}/messages?limit=100`);
    if (!page) return { saved, error: 'no access' };
    // Se guardan de más viejo a más nuevo para que las respuestas encuentren su original.
    saved += await storeMessages(env, db, page.slice().reverse(), channelId, source, dc);
    if (page.length) {
      await setCursor(db, latestKey, page[0].id);
      await setCursor(db, `backfill:${channelId}`, page.length === 100 ? page[page.length - 1].id : 'done');
    } else {
      await setCursor(db, latestKey, '0');
      await setCursor(db, `backfill:${channelId}`, 'done');
    }
  } else {
    const recent = await dc.get(`/channels/${channelId}/messages?limit=100`);
    if (!recent) return { saved, error: 'no access' };
    // Si en 5 minutos llegaron más de 100, se sigue paginando hacia adelante.
    const newest = recent[0]?.id;
    if (recent.length === 100 && recent.every((m) => BigInt(m.id) > BigInt(after))) {
      while (dc.left > 2) {
        const page = await dc.get(`/channels/${channelId}/messages?limit=100&after=${after}`);
        if (!page?.length) break;
        saved += await storeMessages(env, db, page.slice().reverse(), channelId, source, dc);
        after = page.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), after);
        await setCursor(db, latestKey, after);
        if (page.length < 100) break;
      }
    }
    saved += await storeMessages(env, db, recent.slice().reverse(), channelId, source, dc);
    if (newest && BigInt(newest) > BigInt(after)) await setCursor(db, latestKey, newest);
  }

  // 2) Historia vieja, de a poco.
  const bfKey = `backfill:${channelId}`;
  let before = await getCursor(db, bfKey);
  while (before && before !== 'done' && dc.left > 4) {
    const page = await dc.get(`/channels/${channelId}/messages?limit=100&before=${before}`);
    if (!page) break;
    saved += await storeMessages(env, db, page.slice().reverse(), channelId, source, dc);
    before = page.length === 100 ? page[page.length - 1].id : 'done';
    await setCursor(db, bfKey, before);
  }
  return { saved };
}

async function syncForum(env, db, dc, forumId, source) {
  const forum = await dc.get(`/channels/${forumId}`);
  if (!forum) return { saved: 0, error: 'no access' };
  const tagNames = Object.fromEntries((forum.available_tags || []).map((t) => [t.id, t.name]));

  const threads = [];
  const active = await dc.get(`/guilds/${env.GUILD_ID}/threads/active`);
  (active?.threads || []).filter((t) => t.parent_id === forumId).forEach((t) => threads.push(t));

  const archived = await dc.get(`/channels/${forumId}/threads/archived/public?limit=100`);
  (archived?.threads || []).forEach((t) => threads.push(t));

  // Posts archivados más viejos, de a poco.
  const bfKey = `backfill:${forumId}`;
  let before = await getCursor(db, bfKey);
  if (before === null && archived?.has_more && archived.threads.length) {
    before = archived.threads[archived.threads.length - 1].thread_metadata.archive_timestamp;
  } else if (before === null) before = 'done';
  while (before !== 'done' && dc.left > 6) {
    const page = await dc.get(`/channels/${forumId}/threads/archived/public?limit=100&before=${encodeURIComponent(before)}`);
    if (!page) break;
    page.threads.forEach((t) => threads.push(t));
    before = page.has_more && page.threads.length ? page.threads[page.threads.length - 1].thread_metadata.archive_timestamp : 'done';
  }
  await setCursor(db, bfKey, before);

  // Los posts nuevos necesitan leer su primer mensaje; los conocidos solo se actualizan.
  const ids = [...new Set(threads.map((t) => t.id))];
  const knownRows = new Map();
  const known = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db.prepare(`SELECT id, title, forum_tags, replies FROM items WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    rows.results.forEach((r) => { known.add(r.id); knownRows.set(r.id, r); });
  }

  const stmts = [];
  const seen = new Set();
  let pending = 0;
  for (const t of threads) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const tags = (t.applied_tags || []).map((id) => tagNames[id]).filter(Boolean);
    if (known.has(t.id)) {
      const k = knownRows.get(t.id);
      if (k && k.title === t.name && k.forum_tags === JSON.stringify(tags) && k.replies === (t.message_count || 0)) continue; // sin cambios
      stmts.push(
        db.prepare('UPDATE items SET title = ?, forum_tags = ?, replies = ? WHERE id = ?')
          .bind(t.name, JSON.stringify(tags), t.message_count || 0, t.id),
      );
      continue;
    }
    if (dc.left <= 6) {
      pending++;
      continue;
    }
    const starter = await dc.get(`/channels/${t.id}/messages/${t.id}`);
    const msg = starter || { id: t.id, content: '', timestamp: t.thread_metadata?.create_timestamp || new Date().toISOString(), author: { id: t.owner_id }, type: 0 };
    if (!msg.timestamp) msg.timestamp = new Date().toISOString();
    const it = messageToItem(msg, { guildId: env.GUILD_ID, channelId: forumId, source, thread: t, forumTags: tags });
    await fillTextAttachment(db, dc, it);
    stmts.push(upsertStmt(db, it));
  }
  if (stmts.length) await db.batch(stmts);
  // Si quedaron posts sin leer, el backfill del foro se reinicia para retomarlos.
  if (pending) await setCursor(db, bfKey, null);
  return { saved: stmts.length, pending };
}

// Canales configurados en wrangler.toml, ej. "123:player-feedback:text,456:bug-reports:forum"
export function parseChannels(spec) {
  return String(spec || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, source, kind = 'text'] = s.split(':');
      return { id, source, kind };
    });
}

export async function syncAll(env) {
  const db = env.DB;
  const dc = new Discord(env.DISCORD_BOT_TOKEN, env.DISCORD_API || API);
  const report = {};
  // Se rota el orden para que ningún canal se quede siempre sin presupuesto.
  const channels = parseChannels(env.CHANNELS);
  const turn = Number((await getCursor(db, 'turn')) || 0);
  await setCursor(db, 'turn', String((turn + 1) % Math.max(1, channels.length)));
  const ordered = channels.slice(turn % Math.max(1, channels.length)).concat(channels.slice(0, turn % Math.max(1, channels.length)));
  for (const ch of ordered) {
    try {
      report[ch.source] = ch.kind === 'forum' ? await syncForum(env, db, dc, ch.id, ch.source) : await syncTextChannel(env, db, dc, ch.id, ch.source);
    } catch (e) {
      if (e instanceof BudgetError) {
        report[ch.source] = { stopped: e.message || 'call budget used up, continues next run' };
        break;
      }
      report[ch.source] = { error: String(e.message || e) };
    }
  }
  try { report.text_files = await repairTextAttachments(env, db, dc); } catch (e) { report.text_files = String(e.message || e); }
  await setCursor(db, 'last_sync', new Date().toISOString());
  report.calls = dc.calls;
  return report;
}

// Respuestas de un post del foro, leídas en el momento (no se guardan).
export async function fetchThreadMessages(env, threadId) {
  const dc = new Discord(env.DISCORD_BOT_TOKEN, env.DISCORD_API || API);
  const page = await dc.get(`/channels/${threadId}/messages?limit=50`);
  if (!page) return [];
  return page
    .filter((m) => m.id !== threadId && [0, 19].includes(m.type))
    .reverse()
    .map((m) => ({
      id: m.id,
      author_name: m.author?.global_name || m.author?.username,
      content: m.content,
      attachments: (m.attachments || []).map((a) => ({ url: a.url, name: a.filename, type: a.content_type || '' })),
      created_at: m.timestamp,
    }));
}
