import APP_HTML from './app.html';
import { currentUser, login, callback, logout, page } from './auth.js';
import { syncAll, fetchThreadMessages, BUDGET } from './sync.js';
import { classifyPending } from './ai.js';
import { guessCategory, SYSTEMS } from './parse.js';

const STATUSES = ['new', 'reviewed', 'planned', 'in_progress', 'fixed', 'wontfix'];
const CATEGORIES = ['bug', 'idea', 'gameplay', 'balance', 'controls', 'performance', 'network', 'maps', 'ui', 'audio', 'praise', 'other', 'spam'];
const STATUS_LABEL = { new: 'New', reviewed: 'Reviewed', planned: 'Planned', in_progress: 'In progress', fixed: 'Fixed', wontfix: "Won't fix" };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const JSON_COLS = ['fields', 'attachments', 'forum_tags', 'tags', 'systems'];
function decode(row) {
  for (const c of JSON_COLS) if (typeof row[c] === 'string') try { row[c] = JSON.parse(row[c]); } catch { row[c] = []; }
  return row;
}

async function updateItem(env, id, body, user) {
  const sets = [];
  const vals = [];
  const log = [];
  const cur = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!cur) return null;
  if (body.status !== undefined && STATUSES.includes(body.status) && body.status !== cur.status) {
    sets.push('status = ?'); vals.push(body.status); log.push(`set status to ${STATUS_LABEL[body.status]}`);
  }
  // "No es spam": vuelve al tema que sugieren las palabras del texto.
  if (body.not_spam === true) {
    let guess = guessCategory(`${cur.title || ''} ${cur.content || ''}`);
    if (guess === 'spam') guess = 'other';
    body.category = guess;
    log.push('marked as not spam');
  }
  if (body.category !== undefined && (body.category === null || CATEGORIES.includes(body.category)) && body.category !== cur.category) {
    sets.push('category = ?'); vals.push(body.category); log.push(`set category to ${body.category || 'none'}`);
  }
  if (body.priority !== undefined && [null, 1, 2, 3].includes(body.priority) && body.priority !== cur.priority) {
    sets.push('priority = ?'); vals.push(body.priority); log.push(`set priority to ${({ 1: 'high', 2: 'medium', 3: 'low' })[body.priority] || 'none'}`);
  }
  if (Array.isArray(body.tags)) {
    const tags = [...new Set(body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    if (JSON.stringify(tags) !== cur.tags) { sets.push('tags = ?'); vals.push(JSON.stringify(tags)); log.push(`set tags to ${tags.join(', ') || 'none'}`); }
  }
  // Partes del juego ("Mentions") corregidas por el equipo: la IA ya no las toca.
  if (Array.isArray(body.systems)) {
    const systems = [...new Set(body.systems.map((x) => String(x)).filter((x) => x in SYSTEMS))];
    const before = JSON.parse(cur.systems || '[]');
    if (JSON.stringify(systems) !== JSON.stringify(before)) {
      sets.push('systems = ?', 'systems_by_team = 1'); vals.push(JSON.stringify(systems));
      const added = systems.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !systems.includes(x));
      log.push([added.length ? `added tag ${added.join(', ')}` : '', removed.length ? `removed tag ${removed.join(', ')}` : ''].filter(Boolean).join(' and '));
    }
  }
  if (typeof body.notes === 'string' && body.notes !== (cur.notes || '')) {
    sets.push('notes = ?'); vals.push(body.notes.slice(0, 5000)); log.push('edited the notes');
  }
  if (body.duplicate_of !== undefined && body.duplicate_of !== cur.duplicate_of) {
    let target = body.duplicate_of;
    if (target) {
      if (target === id) return { error: "Can't be a duplicate of itself" };
      // Siempre se apunta al principal, no a otro duplicado.
      const t = await env.DB.prepare('SELECT id, duplicate_of FROM items WHERE id = ?').bind(target).first();
      if (!t) return { error: 'That feedback does not exist' };
      target = t.duplicate_of || t.id;
      if (target === id) return { error: 'That feedback is already a duplicate of this one' };
    }
    sets.push('duplicate_of = ?'); vals.push(target || null);
    log.push(target ? 'marked as duplicate' : 'unmarked as duplicate');
    // Los duplicados de este pasan al nuevo principal.
    if (target) await env.DB.prepare('UPDATE items SET duplicate_of = ? WHERE duplicate_of = ?').bind(target, id).run();
  }
  if (!sets.length) return { ok: true };
  const now = new Date().toISOString();
  sets.push('updated_at = ?', 'updated_by = ?');
  vals.push(now, user.name);
  const stmts = [env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id)];
  for (const l of log) stmts.push(env.DB.prepare('INSERT INTO activity (item_id, user_name, action, at) VALUES (?, ?, ?, ?)').bind(id, user.name, l, now));
  await env.DB.batch(stmts);
  return { ok: true };
}

async function api(req, env, user, path) {
  const method = req.method;
  if (method !== 'GET' && !(req.headers.get('Content-Type') || '').includes('application/json')) return json({ error: 'json required' }, 415);

  if (path === '/api/me') {
    const last = await env.DB.prepare("SELECT value FROM cursors WHERE key = 'last_sync'").first();
    return json({ user, last_sync: last?.value || null, statuses: STATUSES, categories: CATEGORIES });
  }

  if (path === '/api/items' && method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id, source, url, author_name, title, content, fields, attachments, forum_tags, build, context, mode, reactions, replies,
       created_at, status, category, auto_category, systems, systems_by_team, liked, ai_at, ai_title, priority, tags, notes, duplicate_of, updated_at, updated_by,
       (SELECT COUNT(*) FROM team_messages t WHERE t.item_id = items.id) AS team_count,
       (SELECT MAX(created_at) FROM team_messages t WHERE t.item_id = items.id) AS team_last
       FROM items ORDER BY created_at DESC`,
    ).all();
    return json(rows.results.map(decode));
  }

  const m = path.match(/^\/api\/items\/([\w:-]+)$/);
  if (m && method === 'GET') {
    const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(m[1]).first();
    if (!item) return json({ error: 'not found' }, 404);
    const [comments, activity, dups, team] = await Promise.all([
      env.DB.prepare('SELECT * FROM comments WHERE item_id = ? ORDER BY created_at').bind(m[1]).all(),
      env.DB.prepare('SELECT * FROM activity WHERE item_id = ? ORDER BY at DESC LIMIT 50').bind(m[1]).all(),
      env.DB.prepare('SELECT id, title, content, author_name, source, created_at FROM items WHERE duplicate_of = ? ORDER BY created_at').bind(m[1]).all(),
      env.DB.prepare('SELECT * FROM team_messages WHERE item_id = ? ORDER BY id').bind(m[1]).all(),
    ]);
    let thread = comments.results;
    if (item.thread_id) {
      try { thread = await fetchThreadMessages(env, item.thread_id); } catch { /* se muestra lo guardado */ }
    }
    return json({ item: decode(item), comments: thread, activity: activity.results, duplicates: dups.results, team: team.results });
  }
  if (m && method === 'PATCH') {
    const r = await updateItem(env, m[1], await req.json(), user);
    if (!r) return json({ error: 'not found' }, 404);
    return json(r, r.error ? 400 : 200);
  }

  // Chat del equipo sobre un feedback.
  const c = path.match(/^\/api\/items\/([\w:-]+)\/chat$/);
  if (c && method === 'GET') {
    const after = Number(new URL(req.url).searchParams.get('after') || 0);
    const rows = await env.DB.prepare('SELECT * FROM team_messages WHERE item_id = ? AND id > ? ORDER BY id').bind(c[1], after).all();
    return json(rows.results);
  }
  if (c && method === 'POST') {
    const { body } = await req.json();
    const text = String(body || '').trim().slice(0, 4000);
    if (!text) return json({ error: 'Write something first' }, 400);
    const exists = await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(c[1]).first();
    if (!exists) return json({ error: 'not found' }, 404);
    const now = new Date().toISOString();
    const row = await env.DB.prepare('INSERT INTO team_messages (item_id, user_id, user_name, avatar, body, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(c[1], user.id, user.name, user.avatar || null, text, now).first();
    return json(row);
  }
  const dm = path.match(/^\/api\/chat\/(\d+)$/);
  if (dm && method === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM team_messages WHERE id = ? AND user_id = ?').bind(Number(dm[1]), user.id).run();
    return json({ ok: r.meta.changes > 0 });
  }
  if (path === '/api/discussions' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT t.*, i.title, i.content, i.fields, i.build, i.source FROM team_messages t JOIN items i ON i.id = t.item_id
      WHERE t.id IN (SELECT MAX(id) FROM team_messages GROUP BY item_id) ORDER BY t.id DESC LIMIT 20`).all();
    return json(rows.results.map(decode));
  }

  if (path === '/api/bulk' && method === 'POST') {
    const { ids, changes } = await req.json();
    if (!Array.isArray(ids) || ids.length > 200) return json({ error: 'invalid ids' }, 400);
    for (const id of ids) await updateItem(env, String(id), changes || {}, user);
    return json({ ok: true, count: ids.length });
  }

  if (path === '/api/sync' && method === 'POST') {
    return json(await runSync(env));
  }

  return json({ error: 'not found' }, 404);
}

// Lee Discord y, con las llamadas que sobran, clasifica con IA lo pendiente.
async function runSync(env) {
  const report = await syncAll(env);
  try { report.ai = await classifyPending(env, Math.min(15, 46 - (report.calls || BUDGET))); } catch (e) { report.ai = { error: String(e.message || e) }; }
  return report;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n');
    if (path === '/auth/login') return login(req, env);
    if (path === '/auth/callback') return callback(req, env);
    if (path === '/auth/logout') return logout();

    const user = await currentUser(req, env);
    if (!user) {
      if (path.startsWith('/api/')) return json({ error: 'login' }, 401);
      return page('Internal team dashboard. Sign in with your Discord account.');
    }
    if (path.startsWith('/api/')) {
      try {
        return await api(req, env, user, path);
      } catch (e) {
        return json({ error: String(e.message || e) }, 500);
      }
    }
    return new Response(APP_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env).then((r) => console.log('sync', JSON.stringify(r))));
  },
};
