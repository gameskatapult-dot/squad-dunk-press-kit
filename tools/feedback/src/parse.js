// Convierte mensajes de Discord en items de feedback.

export const CATEGORIES = {
  bug: ['bug', 'glitch', 'crash', 'stuck', 'broken', 'error', 'freeze', 'froze', 'doesnt work', "doesn't work", 'not working', 'falls through', 'went through', 'goes through', 'clip', 'teleport', 'invisible', 'softlock', 'invisible wall', 'janky'],
  performance: ['lag', 'fps', 'stutter', 'performance', 'frame', 'slow', 'ping', 'laggy'],
  network: ['disconnect', 'desync', 'server', 'connection', 'matchmaking', 'queue', 'kicked'],
  controls: ['control', 'keybind', 'key bind', 'controller', 'mouse', 'click', 'input', 'sensitivity', 'rebind'],
  balance: ['op', 'overpowered', 'nerf', 'buff', 'balance', 'too strong', 'too weak', 'unfair', 'too easy', 'too hard', 'inconsistent', 'inconsistant', 'broken'],
  gameplay: ['shot', 'shoot', 'shooting', 'throw', 'layup', 'dunk', 'steal', 'dribble', 'pass', 'stamina', 'jump', 'movement', 'poke', 'swipe', 'block', 'meter', 'momentum', 'alley oop'],
  maps: ['map', 'court', 'arena', 'stage', 'jungle', 'vine', 'day and night'],
  ui: ['menu', 'ui', 'hud', 'settings', 'scoreboard', 'slider', 'interface', 'button prompt'],
  audio: ['sound', 'audio', 'music', 'volume', 'sfx', 'microphone', 'mic'],
  idea: ['add', 'would be cool', 'would be nice', 'would love', 'would like', 'i want', 'i wish', 'we need', 'should', 'suggest', 'feature', 'mode', 'bots', 'cosmetic', 'skin', 'customization', 'ranked', 'wish', 'option', 'more', 'new', '1v1', '2v2', '3v3'],
};
const PRAISE = ['good game', 'great game', 'awesome', 'amazing', 'love', 'fun', 'really good', 'well done', 'its good', "it's good", 'all good', 'so good', 'enjoy'];

// Sistemas del juego, para saber qué parte del juego menciona cada feedback.
export const SYSTEMS = {
  shooting: ['shoot', 'shot', 'shooting', 'throw', 'throwing', 'trowing', 'meter', 'jumper', 'three', '3pt', 'aim', 'trajectory', 'trickshot', 'fake shot'],
  layup: ['layup', 'lay up', 'backboard'],
  dunk: ['dunk', 'dunking', 'slam', 'alley', 'oop'],
  steal: ['steal', 'stealing', 'stole', 'unstealable', 'poke', 'swipe', 'taking the ball', 'block', 'blocking', 'tackle', 'knockout', 'cherrypicking'],
  dribble: ['dribble', 'dribbling', 'crossover', 'crossing', 'between the legs', 'step back', 'handle'],
  passing: ['pass', 'passing', 'screen', 'teammate'],
  movement: ['movement', 'move', 'run', 'running', 'sprint', 'jump', 'diving', 'push', 'momentum'],
  stamina: ['stamina', 'energy', 'tired'],
  camera: ['camera', 'cam', 'fov', 'view', 'third person', '3rd person'],
  tutorial: ['tutorial', 'instruction', 'how to', 'learn', 'onboarding', 'explained', 'taught', 'beginner', 'guide', 'coach'],
  lobby: ['lobby', 'waiting area', 'practice', 'pregame', 'party', 'invite', 'queue', 'matchmaking', 'recall', 'call ball', 'respawn the ball'],
  social: ['friend', 'chat', 'emote', 'emoting', 'emoji', 'voice', 'speak', 'microphone', 'mic', 'team'],
  network: ['lag', 'ping', 'disconnect', 'server', 'desync', 'rubber'],
  ui: ['menu', 'ui', 'hud', 'settings', 'scoreboard', 'slider', 'interface'],
  audio: ['sound', 'audio', 'music', 'sfx', 'volume'],
  bots: ['bot', 'ai', 'solo', 'alone', 'offline', 'by yourself', 'on my own', 'on your own', 'self alley', 'self assist', 'without help'],
  maps: ['map', 'court', 'jungle', 'vine', 'day and night'],
  cosmetics: ['shop', 'clothes', 'skin', 'cosmetic', 'outfit', 'style'],
};

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Coincide la palabra con plurales y terminaciones comunes (shot/shots, steal/stealing).
const wordRe = (w) => new RegExp(`(^|[^a-z])${esc(w)}(s|es|ing|ed|er|ers)?([^a-z]|$)`);
const has = (t, w) => wordRe(w).test(t);
const clean = (text) => ` ${String(text || '').toLowerCase().replace(/[’']/g, "'")} `;

export function guessSystems(text) {
  const t = clean(text);
  return Object.entries(SYSTEMS).filter(([, words]) => words.some((w) => has(t, w))).map(([k]) => k);
}

// ¿Es una tontera? (vacío, una palabra suelta sin sentido, teclado aplastado, "test"…)
// "Not answered" es lo que manda el juego cuando el jugador deja la pregunta vacía.
const EMPTY_ANSWERS = /^(not answered|no answer|nothing|nothing really|nothing much|not really|none|nope|no|nah|idk|i dont know|i don't know|n\/?a|na|ok|okay|k|lol|lmao|xd|test|testing|asdf|hi|hello|yo|-+|\.+|\?+)$/i;
const EMPTY_WORDS = new Set(['idk', 'nothing', 'none', 'no', 'nah', 'nope', 'na', 'ok', 'okay', 'lol', 'lmao', 'xd', 'test', 'hi', 'hello', 'yo', 'not', 'answered']);
const normAnswer = (text) => String(text || '').toLowerCase().replace(/<a?:\w+:\d+>/g, ' ').replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
export function isJunkAnswer(text) {
  const t = normAnswer(text);
  if (!t) return true;
  if (EMPTY_ANSWERS.test(t)) return true;
  const words = t.split(' ');
  if (words.every((w) => EMPTY_WORDS.has(w))) return true; // "idk idk idk", "nothing nothing"
  if (/(.)\1{3,}/.test(t.replace(/\s/g, '')) && words.length <= 2) return true; // "aaaaa", "lolllll"
  if (words.length === 1) {
    const w = words[0];
    if (guessSystems(w).length || guessCategory(w) !== 'other') return false; // "lag", "dunks", "bugs" sí dicen algo
    return true;
  }
  if (words.length <= 3 && !/[aeiouy]/.test(t)) return true; // "sdfg hjk"
  return false;
}
// Respuesta a "¿algo te frustró?" que en realidad dice que no ("nothing really, fun game", "nah all good").
const NO_PROBLEM = /^(nothing|not really|not much|nah|no|nope|none|idk|all good|everything (was )?(good|fine|great))\b/;
export function isNoProblem(text) {
  if (isJunkAnswer(text)) return true;
  const t = normAnswer(text);
  return NO_PROBLEM.test(t) && !guessSystems(t).length && !['bug', 'performance', 'network', 'balance', 'controls'].includes(guessCategory(t));
}
// Campos del embed que son datos, no respuestas ("Completed matches: 3", "Hours in completed matches: 0.4").
export const isStatField = (q) => /completed matches|hours/i.test(String(q || ''));
// Spam = no dice nada útil en ninguna respuesta.
export function isJunk(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter((x) => x != null);
  return list.length === 0 || list.every(isJunkAnswer);
}

// Tags de los foros de Discord (bug-reports, beta-feedback): el jugador ya dijo de qué se trata.
// Se busca por pedazo de palabra para aguantar variantes ("Customisation", "Customization", "Settings & UI").
const TAG_HINTS = [
  { m: /bug|crash|glitch/, cat: 'bug' },
  // Tags de gravedad del foro bug-reports ("Critical", "Hardly Playable", "Playable"): siempre es un bug.
  { m: /playable|critical|severe|blocker|game.?breaking/, cat: 'bug' },
  { m: /practice/, cat: 'gameplay', systems: ['lobby'] },
  { m: /perform|fps|lag/, cat: 'performance', systems: ['network'] },
  { m: /network|server|connect|matchmak/, cat: 'network', systems: ['network'] },
  { m: /control|keybind|input/, cat: 'controls' },
  { m: /balanc/, cat: 'balance' },
  // "Settings" sin sistema: a veces piden una opción para una mecánica (ej. marcas en el medidor de tiro).
  { m: /setting|menu|\bui\b|hud|interface/, cat: 'ui' },
  { m: /audio|sound|music/, cat: 'audio', systems: ['audio'] },
  { m: /\bmaps?\b|court/, cat: 'maps', systems: ['maps'] },
  { m: /custom|cosmetic|skin|outfit|shop/, cat: 'idea', systems: ['cosmetics'] },
  { m: /tutorial|onboard/, cat: 'gameplay', systems: ['tutorial'] },
  { m: /suggest|idea|feature|request|\bmodes?\b/, cat: 'idea' },
  { m: /gameplay|mechanic/, cat: 'gameplay' },
];
const tagHints = (forumTags = []) => forumTags.map((x) => String(x).toLowerCase()).flatMap((t) => TAG_HINTS.filter((h) => h.m.test(t)));
// Partes del juego que salen directo de los tags del post.
export function systemsFromTags(forumTags = []) {
  return [...new Set(tagHints(forumTags).flatMap((h) => h.systems || []))];
}

export function guessCategory(text, forumTags = []) {
  const t = clean(text);
  const hints = tagHints(forumTags);
  if (hints.some((h) => h.cat === 'bug')) return 'bug';
  let best = null;
  let bestScore = 0;
  for (const [cat, words] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const w of words) if (has(t, w)) score += cat === 'idea' ? 0.5 : cat === 'gameplay' ? 0.8 : 1;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  if (best) return best;
  // Si el texto no dice nada claro, manda el tag (primero los concretos como Settings o Audio, después Gameplay/Modes).
  const specific = hints.find((h) => !['gameplay', 'idea'].includes(h.cat)) || hints[0];
  if (specific) return specific.cat;
  if (PRAISE.some((w) => has(t, w))) return 'praise';
  return 'other';
}

// Pie de los embeds del juego: "Build 0.6.8 · post-match · Lobby · Submission 6649e8..."
export function parseFooter(text) {
  const out = { build: null, context: null, mode: null, submission_id: null };
  if (!text) return out;
  const parts = String(text).split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean);
  const rest = [];
  for (const p of parts) {
    let m;
    if ((m = p.match(/^build\s+v?([\w.\-]+)/i))) out.build = m[1];
    else if ((m = p.match(/^submission\s+([\w\-]+)/i))) out.submission_id = m[1];
    else rest.push(p);
  }
  if (rest[0]) out.context = rest[0];
  if (rest[1]) out.mode = rest[1];
  return out;
}

function attachmentsOf(msg) {
  const list = (msg.attachments || []).map((a) => ({
    url: a.url,
    name: a.filename,
    type: a.content_type || '',
  }));
  for (const e of msg.embeds || []) {
    if (e.image?.url) list.push({ url: e.image.url, name: 'imagen', type: 'image/' });
  }
  return list;
}

function reactionCount(msg) {
  return (msg.reactions || []).reduce((n, r) => n + (r.count || 0), 0);
}

export function messageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// ¿Es un envío del formulario del juego?
export function isGameEmbed(msg) {
  if (!msg.author?.bot) return false;
  return (msg.embeds || []).some((e) => /build\s+v?[\d.]+/i.test(e.footer?.text || '') || /feedback/i.test(e.title || ''));
}

// Mensaje de un canal de texto (o primer mensaje de un post del foro) -> item
export function messageToItem(msg, { guildId, channelId, source, thread = null, forumTags = [] }) {
  const item = {
    id: thread ? thread.id : msg.id,
    source,
    channel_id: channelId,
    thread_id: thread ? thread.id : null,
    url: messageUrl(guildId, thread ? thread.id : channelId, thread ? '' : msg.id).replace(/\/$/, ''),
    author_id: msg.author?.id || null,
    author_name: msg.author?.global_name || msg.author?.username || null,
    title: thread ? thread.name : null,
    content: msg.content || '',
    fields: [],
    attachments: attachmentsOf(msg),
    forum_tags: forumTags,
    build: null,
    context: null,
    mode: null,
    submission_id: null,
    reactions: reactionCount(msg),
    replies: thread ? thread.message_count || 0 : 0,
    created_at: msg.timestamp,
  };

  if (isGameEmbed(msg)) {
    const e = msg.embeds.find((x) => x.fields?.length || x.description || x.footer) || msg.embeds[0];
    item.source = 'game';
    item.author_name = e.author?.name || 'Player (in-game)';
    item.author_id = null;
    item.fields = (e.fields || []).map((f) => ({ q: f.name, a: f.value }));
    const footer = parseFooter(e.footer?.text || '');
    // A veces el pie viene dentro de la descripción.
    if (!footer.build && e.description) Object.assign(footer, parseFooter(e.description.split('\n').pop()));
    Object.assign(item, footer);
    const desc = e.description && !/build\s+v?[\d.]+/i.test(e.description) ? e.description : '';
    item.content = [desc, ...item.fields.map((f) => `${f.q}\n${f.a}`)].filter(Boolean).join('\n\n');
    if (e.timestamp) item.created_at = e.timestamp;
  }

  // Si alguien escribe la versión en el texto ("v0.6.8", "build 0.6.7"), se toma.
  if (!item.build) {
    const m = `${item.title || ''} ${item.content}`.match(/\b(?:v|build\s*)(\d+\.\d+(?:\.\d+)?)\b/i);
    if (m) item.build = m[1];
  }

  return deriveFields(item, forumTags);
}

// Las 3 preguntas del formulario del juego: qué le gustó, qué le frustró, qué agregaría.
export const VOICES = ['love', 'pain', 'want'];
export function answerKind(q) {
  const t = String(q || '').toLowerCase();
  if (/enjoy|like|fun|best/.test(t)) return 'love';
  if (/frustrat|confus|annoy|worst|hate|problem|issue/.test(t)) return 'pain';
  if (/add|wish|want|improve|change|missing/.test(t)) return 'want';
  return null;
}
// Partes del juego por respuesta ({love:[], pain:[], want:[]}). Vacío si no es del formulario.
export function guessVoice(fields = []) {
  const out = {};
  for (const f of fields) {
    const k = answerKind(f.q);
    if (!k || isJunkAnswer(f.a)) continue;
    out[k] = [...new Set([...(out[k] || []), ...guessSystems(f.a)])];
  }
  return out;
}

// Calcula lo automático (lo que le gustó, sistemas, tema sugerido, spam) a partir del texto.
export function deriveFields(item, forumTags = item.forum_tags || []) {
  // En los envíos del juego se clasifica solo por las respuestas, no por las preguntas.
  // "Lo que le gustó" se guarda aparte y no cuenta como problema.
  const likedField = item.fields.find((f) => /enjoy|like|fun|best/i.test(f.q));
  item.liked = likedField && !isJunkAnswer(likedField.a) ? likedField.a : null;
  const problemFields = item.fields.filter((f) => f !== likedField && !isStatField(f.q) && !isJunkAnswer(f.a));
  const answers = item.fields.length ? problemFields.map((f) => f.a).join(' ') : item.content;
  item.systems = [...new Set([...guessSystems(`${item.title || ''} ${answers}`), ...systemsFromTags(forumTags)])];
  item.auto_category = guessCategory(`${item.title || ''} ${answers}`, forumTags);
  const allAnswers = item.fields.length ? item.fields.filter((f) => !isStatField(f.q)).map((f) => f.a) : [item.title, item.content].filter(Boolean);
  if (!item.attachments.length && !forumTags.length && isJunk(allAnswers)) item.auto_category = 'spam';
  item.voice = guessVoice(item.fields);
  return item;
}

// ¿Este mensaje vale como feedback propio, o es ruido / respuesta?
export function isSkippable(msg, botUserId) {
  if (msg.author?.id === botUserId) return true;
  if (![0, 19].includes(msg.type)) return true; // solo mensajes normales y respuestas
  const hasText = (msg.content || '').trim().length > 0;
  const hasStuff = (msg.attachments || []).length > 0 || (msg.embeds || []).length > 0;
  if (!hasText && !hasStuff) return true;
  if (msg.author?.bot && !isGameEmbed(msg)) return true;
  return false;
}

// Reglas baratas (sin IA) que corrigen errores típicos del tema que puso la IA.
// Recibe el item como viene de la base (strings JSON o ya decodificado) y el tema propuesto.
export function fixTopic(it, topic) {
  const arr = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : v || []);
  const fields = arr(it.fields);
  const tags = arr(it.forum_tags);
  const hasStuff = arr(it.attachments).length || tags.length;
  // 1. El jugador eligió un tag de bug o de gravedad en el foro.
  if (tagHints(tags).some((h) => h.cat === 'bug')) return 'bug';
  // 2. Nada útil en ninguna respuesta ("idk idk idk", "???"): spam aunque la IA dudara. Un "GREAT" suelto sigue siendo praise.
  const answers = fields.length ? fields.filter((f) => !isStatField(f.q)).map((f) => f.a) : [it.title, it.content].filter(Boolean);
  if (!hasStuff && topic === 'other' && isJunk(answers)) return 'spam';
  // 3. Encuesta del juego marcada "praise" pero que sí cuenta un problema o pide algo.
  if (topic === 'praise' && fields.length) {
    const pain = fields.filter((f) => answerKind(f.q) === 'pain' && !isNoProblem(f.a)).map((f) => f.a).join(' ');
    const want = fields.filter((f) => answerKind(f.q) === 'want' && !isNoProblem(f.a)).map((f) => f.a).join(' ');
    const free = fields.filter((f) => /^feedback$/i.test(f.q)).map((f) => f.a).join(' ');
    if (pain) {
      const c = guessCategory(pain);
      return ['praise', 'other', 'idea', 'spam'].includes(c) ? 'gameplay' : c;
    }
    if (want) return 'idea';
    if (free) {
      const c = guessCategory(free);
      if (!['praise', 'other', 'spam'].includes(c)) return c;
    }
  }
  return topic;
}

// "Set a screen" / "pick and roll" es una jugada de básquet, no una pantalla del menú.
export function fixSystems(text, systems) {
  const t = clean(text);
  if (!/(set(ting)?|make|do) (a |some )?screens?|pick and roll|pick n roll/.test(t)) return systems;
  const menu = SYSTEMS.ui.some((w) => has(t, w));
  return [...new Set([...systems.filter((s) => menu || s !== 'ui'), 'passing'])];
}
