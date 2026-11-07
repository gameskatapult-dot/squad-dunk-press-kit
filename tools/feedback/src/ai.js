// Clasificación con IA (Workers AI de Cloudflare, gratis dentro del límite diario).
// Lee cada feedback y decide el tema, las partes del juego que menciona y si es spam.
// Lo que el equipo confirma a mano (columna category) nunca se toca: la IA solo llena auto_category y systems.

import { CATEGORIES, SYSTEMS, guessSystems } from './parse.js';

// Palabras que casi nunca se usan en otro sentido.
const SURE = ['dunk', 'layup', 'steal', 'dribble', 'stamina', 'shooting', 'camera'];
// Modelo grande: mucho más preciso que el 8B (que confundía todo con UI). Gasta más cuota diaria gratis.
// Se puede cambiar con la variable AI_MODEL (wrangler.toml).
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TOPICS = [...Object.keys(CATEGORIES), 'praise', 'other', 'spam'];
const SYSTEM_HELP = {
  shooting: 'shooting, throwing, shot meter, aiming',
  layup: 'layups',
  dunk: 'dunking, alley-oops',
  steal: 'stealing, poking, swiping, blocking, taking the ball',
  dribble: 'dribbling, ball handling, crossovers',
  passing: 'passing, teammates, plays',
  movement: 'running, jumping, diving, pushing, character movement',
  stamina: 'stamina, energy',
  camera: 'the in-game camera, camera angle, field of view',
  tutorial: 'ONLY when the player talks about the tutorial or wants the game to teach/explain how to play',
  lobby: 'lobby, waiting area, queue, matchmaking, parties',
  social: 'friends, chat, emotes, voice',
  network: 'lag, ping, disconnects, servers',
  ui: 'ONLY menus, HUD, on-screen indicators, settings screens, scoreboard',
  audio: 'sound, music',
  bots: 'bots, solo play, playing alone',
  maps: 'maps, courts',
  cosmetics: 'shop, skins, clothes, cosmetics',
};

const PROMPT = `You sort player feedback for DUNK, an online 3v3 arcade basketball game.
Reply with ONLY a JSON object, no other text:
{"title": "...", "topic": "...", "systems": ["..."], "spam": false}

title: a short English headline of 3 to 8 words that says what the feedback is about, like "Steals feel random" or "Disconnected mid match" or "Wants a 1v1 mode". No quotes, no period.

topic: exactly one of ${TOPICS.join(', ')}. Pick the MAIN point of the feedback.
- bug: something is broken or glitchy (stuck, falls through, crash, wrong behaviour).
- performance: low fps, stutter, freezes. network: lag, ping, disconnects, servers, matchmaking.
- controls: input, keybinds, controller support, sensitivity, how buttons map to actions.
- balance: something is too strong, too weak, too easy, too hard or unfair (a mechanic, a player, a team size).
- gameplay: how a mechanic feels or works (shooting, dunking, steals, movement, stamina, ball physics), including when a mechanic is confusing or hard to understand.
- idea: a request for something new (feature, mode, content, customization, more moves).
- ui: ONLY about menus, HUD, on-screen indicators, settings screens or the scoreboard. A confusing MECHANIC is gameplay, not ui. "The game is unclear" without naming a screen is gameplay.
- audio: sound or music. maps: courts and maps.
- praise: only positive comments with no request or problem.
- other: useful but none of the above.
- spam: nonsense, a random word or name, keyboard mash, a joke, or says nothing about the game.

systems: the parts of the game the player EXPLICITLY talks about, from this list (can be empty, usually 0 to 2):
${Object.entries(SYSTEM_HELP).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Do not guess: if a part is not named or clearly described, leave it out. Never add ui or tutorial unless menus/HUD/settings or the tutorial are mentioned.

spam: true only when topic is spam.
The answer to "What did you enjoy most?" is praise, not a problem: use it for systems but do not let it decide the topic if there are other answers.

Examples:
"steals are confusing, sometimes i press and nothing happens" -> {"title":"Steals feel unresponsive","topic":"gameplay","systems":["steal"],"spam":false}
"cant find where to change sensitivity in the menu" -> {"title":"Sensitivity setting hard to find","topic":"ui","systems":["ui"],"spam":false}
"let us dunk without a teammate" -> {"title":"Wants solo dunks","topic":"idea","systems":["dunk","bots"],"spam":false}
"shooting from far is way too easy" -> {"title":"Long shots too easy","topic":"balance","systems":["shooting"],"spam":false}
"i didnt understand how to play at first" -> {"title":"Hard to learn how to play","topic":"gameplay","systems":["tutorial"],"spam":false}
"fun game" -> {"title":"Fun game","topic":"praise","systems":[],"spam":false}`;

export function itemText(it) {
  const fields = typeof it.fields === 'string' ? JSON.parse(it.fields || '[]') : it.fields || [];
  const parts = [];
  if (it.title) parts.push(`Title: ${it.title}`);
  if (fields.length) for (const f of fields) parts.push(`${f.q}: ${f.a}`);
  else if (it.content) parts.push(it.content);
  return parts.join('\n').slice(0, 1500);
}

export function parseAnswer(raw) {
  const res = typeof raw === 'string' ? raw : raw?.response ?? raw;
  let o = res && typeof res === 'object' ? res : null; // algunos modelos devuelven el JSON ya armado
  if (!o) {
    const m = String(res ?? '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { o = JSON.parse(m[0]); } catch { return null; }
  }
  let topic = String(o.topic || o.category || '').toLowerCase().trim();
  if (o.spam === true) topic = 'spam';
  if (!TOPICS.includes(topic)) topic = 'other';
  const systems = [...new Set((Array.isArray(o.systems) ? o.systems : []).map((x) => String(x).toLowerCase().trim()).filter((x) => x in SYSTEMS))];
  const title = String(o.title || '').replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 90) || null;
  return { topic, systems, title };
}

export async function classify(env, it) {
  const text = itemText(it);
  if (!text.trim()) return { topic: 'spam', systems: [], title: null };
  const raw = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, {
    messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }],
    max_tokens: 160,
    temperature: 0,
  });
  return parseAnswer(raw);
}

// Clasifica los feedbacks que todavía no pasó por la IA, los más nuevos primero.
export async function classifyPending(env, limit = 10) {
  if (!env.AI || limit <= 0) return { classified: 0, skipped: 'no AI binding' };
  const rows = await env.DB.prepare('SELECT id, title, content, fields, attachments, forum_tags, systems_by_team FROM items WHERE ai_at IS NULL ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  let done = 0;
  let failed = 0;
  let error;
  const now = new Date().toISOString();
  for (const it of rows.results) {
    let r;
    try { r = await classify(env, it); } catch (e) { error = String(e.message || e); break; } // sin cuota o caído: sigue la próxima vez
    if (!r) { failed++; r = { topic: null, systems: null, title: null }; }
    // Un feedback con imagen o tag del foro nunca es spam.
    const hasStuff = JSON.parse(it.attachments || '[]').length || JSON.parse(it.forum_tags || '[]').length;
    if (r.topic === 'spam' && hasStuff) r.topic = 'other';
    // La IA a veces se olvida de un sistema obvio; se suman los que se nombran literalmente.
    const systems = it.systems_by_team ? null : r.systems ? [...new Set([...r.systems, ...guessSystems(itemText(it)).filter((s) => SURE.includes(s))])] : null;
    await env.DB.prepare(`UPDATE items SET ai_at = ?, auto_category = COALESCE(?, auto_category), systems = COALESCE(?, systems), ai_title = ? WHERE id = ?`)
      .bind(now, r.topic, systems ? JSON.stringify(systems) : null, r.topic === 'spam' ? null : r.title, it.id).run();
    done++;
  }
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE ai_at IS NULL').first();
  return { classified: done, unreadable: failed, left: left?.n ?? null, ...(error ? { error } : {}) };
}
