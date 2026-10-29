#!/usr/bin/env node
// DUNK radar: finds and tracks social posts about DUNK. No dependencies, one JSON database.
// Usage: node tools/radar/radar.mjs <command>   (see `help`)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SITE_JSON = path.join(DIR, '../../pages/community/community.json')
const FILES = { config: 'config.json', db: 'db.json', creators: 'creators.json' }
const load = (f, fallback) => fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : fallback
const save = (f, data) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(data, null, 1) + '\n')

const config = load(FILES.config)
const db = load(FILES.db, { posts: {}, rejected: {}, runs: [] })
const creators = load(FILES.creators, [])

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
const H = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' }
const YT_CTX = { client: { clientName: 'WEB', clientVersion: '2.20251020.00.00', hl: 'en' } }
const today = () => new Date().toISOString().slice(0, 10)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const daysSince = d => d ? (Date.now() - Date.parse(d)) / 864e5 : Infinity
const stats = { requests: 0, bytes: 0 }

const strongRe = new RegExp(config.strong.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
// The game's name is written in capitals; lowercase "dunk" is almost always real basketball.
const capsRe = /\bDUNK\b/
const gameRe = new RegExp(config.gameWords, 'i')
const excludeRe = new RegExp(config.exclude, 'i')
const paidRe = new RegExp(config.paid, 'i')
const official = new Set(config.official.map(h => h.toLowerCase()))

// Every network call goes through here, so a run can report what it cost.
async function get (url, opts = {}) {
  await sleep(opts.delay ?? 350)
  const res = await fetch(url, { ...opts, headers: { ...H, ...opts.headers } })
  const text = await res.text()
  stats.requests++
  stats.bytes += text.length
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`)
  return text
}
const ytApi = async (endpoint, body) => JSON.parse(await get(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, context: YT_CTX })
}))

const key = (platform, id) => `${platform}:${id}`
const known = k => db.posts[k] || db.rejected[k]
const handleOf = a => (a || '').toLowerCase()
const creatorFor = (platform, author) => creators.find(c => c.platform === platform && handleOf(c.handle) === handleOf(author))

// ok: clearly DUNK. review: mentions DUNK as a game but not the studio/store. reject: everything else.
function classify (text, author) {
  if (official.has(handleOf(author))) return { verdict: 'reject', reason: 'cuenta oficial' }
  if (strongRe.test(text)) return { verdict: 'ok', reason: (text.match(strongRe) || [])[0] }
  if (excludeRe.test(text)) return { verdict: 'reject', reason: 'excluido: ' + (text.match(excludeRe) || [])[0] }
  const named = capsRe.test(text) || /(?:called|chamado|se llama|se chama|named) dunk\b|\bdunk!/i.test(text)
  if (named && gameRe.test(text)) return { verdict: 'review', reason: 'DUNK + palabra de juego' }
  // Lowercase "dunk" only counts with gaming words or when the creator already posted about DUNK.
  const repeat = Object.values(db.posts).some(p => handleOf(p.author).replace(/[^a-z0-9]/g, '') === handleOf(author).replace(/[^a-z0-9]/g, '') && p.status !== 'descartado')
  if (/\bdunk\b/i.test(text) && (repeat || gameRe.test(text))) return { verdict: 'review', reason: repeat ? 'creador que ya habló de DUNK' : 'dunk + palabra de juego' }
  return { verdict: 'reject', reason: 'sin DUNK' }
}

// ---------- YouTube ----------

function walkVideos (node, out) {
  if (!node || typeof node !== 'object') return
  const v = node.videoRenderer || node.reelItemRenderer
  if (v?.videoId) out.add(v.videoId)
  const shortId = node.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
  if (shortId) out.add(shortId)
  if (node.playlistVideoRenderer?.videoId) out.add(node.playlistVideoRenderer.videoId)
  for (const k in node) walkVideos(node[k], out)
}

async function ytSearch (query) {
  // params EgIIAw== = uploaded this week, so most results are new to us.
  const ids = new Set()
  walkVideos(await ytApi('search', { query, params: 'EgIIAw==' }), ids)
  return [...ids]
}

async function ytChannelId (handle) {
  const r = await ytApi('navigation/resolve_url', { url: 'https://www.youtube.com/' + handle })
  return r.endpoint?.browseEndpoint?.browseId
}

async function ytUploads (channelId) {
  const ids = new Set()
  walkVideos(await ytApi('browse', { browseId: 'VLUU' + channelId.slice(2) }), ids)
  return [...ids]
}

// Videos YouTube suggests next to a DUNK video; other DUNK Shorts tend to show up there.
async function ytRelated (id) {
  // The sidebar uses lockup view models that change often, so read every video id in the response.
  const raw = JSON.stringify(await ytApi('next', { videoId: id }))
  const ids = new Set([...raw.matchAll(/"(?:videoId|contentId)":"([\w-]{11})"/g)].map(m => m[1]))
  ids.delete(id)
  return [...ids]
}

// The player endpoint is ~6 KB per video, against ~1 MB for the watch page.
async function ytVideo (id) {
  let p = await ytApi('player', { videoId: id }).catch(() => null)
  if (!p?.videoDetails) {
    const html = await get('https://www.youtube.com/watch?v=' + id)
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s)
    p = m ? JSON.parse(m[1]) : null
  }
  if (!p?.videoDetails) return null
  const d = p.videoDetails
  const mf = p.microformat?.playerMicroformatRenderer || {}
  return {
    platform: 'youtube',
    id,
    url: 'https://www.youtube.com/watch?v=' + id,
    author: (mf.ownerProfileUrl || '').split('/').pop() || d.author,
    channelId: d.channelId,
    title: d.title,
    desc: (d.shortDescription || '').replace(/\s+/g, ' ').slice(0, 300),
    tags: (d.keywords || []).join(' '),
    date: (mf.publishDate || mf.uploadDate || '').slice(0, 10),
    views: Number(d.viewCount) || 0,
    short: Number(d.lengthSeconds) <= 180
  }
}

// ---------- Bilibili ----------

let biliCookie
async function biliSearch (query) {
  if (!biliCookie) {
    const home = await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } })
    biliCookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
  }
  const j = JSON.parse(await get('https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&keyword=' + encodeURIComponent(query), {
    headers: { referer: 'https://www.bilibili.com/', cookie: biliCookie }, delay: 1200
  }))
  return (j.data?.result || []).map(v => ({
    platform: 'bilibili',
    id: v.bvid,
    url: 'https://www.bilibili.com/video/' + v.bvid,
    author: v.author,
    title: v.title.replace(/<[^>]+>/g, ''),
    desc: (v.description || '').replace(/\s+/g, ' ').slice(0, 300),
    tags: v.tag || '',
    date: new Date(v.pubdate * 1000).toISOString().slice(0, 10),
    views: Number(v.play) || 0,
    likes: Number(v.like) || 0
  }))
}

// ---------- TikTok / Instagram (by link: their search needs a login) ----------

async function tiktokVideo (url) {
  const id = url.match(/video\/(\d+)/)?.[1]
  const html = await get(url)
  const g = re => html.match(re)?.[1]
  // Captions often name the game only at the end, so classify on the whole text.
  const text = JSON.parse('"' + (g(/"desc":"((?:[^"\\]|\\.)*)"/) || '') + '"').replace(/\s+/g, ' ')
  return {
    platform: 'tiktok',
    id,
    url: url.replace(/\?.*/, ''),
    author: '@' + (g(/"uniqueId":"([^"]+)"/) || url.match(/@([\w.]+)/)?.[1]),
    title: text.slice(0, 150),
    desc: text.slice(0, 1500),
    // TikTok ids carry their own upload time in the high 32 bits.
    date: new Date(Number(BigInt(id) >> 32n) * 1000).toISOString().slice(0, 10),
    views: Number(g(/"playCount":(\d+)/)) || 0,
    likes: Number(g(/"diggCount":(\d+)/)) || 0
  }
}

function instagramPost (url, views, likes) {
  const m = url.match(/instagram\.com\/(?:([\w.]+)\/)?(?:reel|p)\/([\w-]+)/)
  return { platform: 'instagram', id: m[2], url: url.replace(/\?.*/, ''), author: m[1] ? '@' + m[1] : '', title: '', desc: '', date: '', views: views || 0, likes: likes || 0, manual: true }
}

// ---------- Database ----------

function record (post, verdict, reason, source) {
  const k = key(post.platform, post.id)
  if (verdict === 'reject') { db.rejected[k] = today(); return null }
  const creator = creatorFor(post.platform, post.author)
  const text = [post.title, post.desc, post.tags].join(' ')
  const entry = {
    ...post,
    status: verdict === 'ok' ? 'nuevo' : 'revisar',
    reason,
    source,
    paid: paidRe.test(text) || undefined,
    firstSeen: today(),
    checked: today(),
    history: [[today(), post.views]]
  }
  entry.tags = (post.tags || '').slice(0, 200) || undefined
  db.posts[k] = entry
  if (!creator && post.author) creators.push({ platform: post.platform, handle: post.author, channelId: post.channelId, jestr: null, added: today() })
  return entry
}

function updateStats (entry, fresh) {
  entry.views = Math.max(entry.views || 0, fresh.views || 0)
  if (fresh.likes) entry.likes = fresh.likes
  entry.date ||= fresh.date
  entry.desc ||= fresh.desc
  entry.paid ||= paidRe.test([fresh.title, fresh.desc, fresh.tags].join(' ')) || undefined
  entry.checked = today()
  const last = entry.history.at(-1)
  if (last[0] === today()) last[1] = entry.views
  else if (last[1] !== entry.views) entry.history.push([today(), entry.views])
}

// Young posts move fast, old ones barely: check less often as they age.
function due (entry) {
  const age = daysSince(entry.date || entry.firstSeen)
  const wait = age <= 7 ? 0.8 : age <= 30 ? 3 : 7
  return daysSince(entry.checked) >= wait
}

// ---------- Commands ----------

async function scan (args) {
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
  const use = s => !only || only.includes(s)
  const found = []
  const consider = async (post, source) => {
    if (!post || known(key(post.platform, post.id))) return
    if (post.date && post.date < config.since) { db.rejected[key(post.platform, post.id)] = today(); return }
    const text = [post.title, post.desc, post.tags].join(' ')
    const { verdict, reason } = classify(text, post.author)
    const entry = record(post, verdict, reason, source)
    if (entry) found.push(entry)
  }

  if (use('youtube')) {
    const ids = new Map()
    for (const q of config.youtube.queries) {
      try { for (const id of await ytSearch(q)) if (!ids.has(id)) ids.set(id, 'búsqueda: ' + q) } catch (e) { console.error('  búsqueda falló:', q, e.message) }
    }
    log(`YouTube búsqueda: ${ids.size} videos, ${[...ids.keys()].filter(id => !known(key('youtube', id))).length} sin revisar`)
    for (const [id, source] of ids) if (!known(key('youtube', id))) await consider(await ytVideo(id).catch(() => null), source)
  }

  if (use('creators')) {
    // Creators who already posted about DUNK often post again; check their latest uploads.
    // A channel page is ~500 KB, so each creator is checked at most once a day.
    const watch = creators.filter(c => c.platform === 'youtube' && c.watch !== false && daysSince(c.checked) >= 0.8)
    for (const c of watch) {
      try {
        c.channelId ||= await ytChannelId(c.handle)
        c.checked = today()
        const fresh = (await ytUploads(c.channelId)).slice(0, 15).filter(id => !known(key('youtube', id)))
        for (const id of fresh) await consider(await ytVideo(id).catch(() => null), 'canal: ' + c.handle)
      } catch (e) { console.error('  canal falló:', c.handle, e.message) }
    }
    log(`YouTube canales: ${watch.length} revisados`)
  }

  if (use('related')) {
    // ~430 KB per video, so each confirmed post is expanded once, while it is young.
    const sources = Object.values(db.posts).filter(p => p.platform === 'youtube' && !p.related && ['nuevo', 'aprobado', 'en-sitio'].includes(p.status) && daysSince(p.date || p.firstSeen) <= 21)
    let checked = 0
    for (const p of sources) {
      try {
        for (const id of await ytRelated(p.id)) if (!known(key('youtube', id))) { await consider(await ytVideo(id).catch(() => null), 'relacionado: ' + p.author); checked++ }
        p.related = today()
      } catch (e) { console.error('  relacionados falló:', p.id, e.message) }
    }
    log(`YouTube relacionados: ${sources.length} videos expandidos, ${checked} sugerencias nuevas`)
  }

  if (use('bilibili')) {
    for (const q of config.bilibili.queries) {
      try { for (const v of await biliSearch(q)) await consider(v, 'bilibili: ' + q) } catch (e) { console.error('  bilibili falló:', q, e.message) }
    }
    log('Bilibili: listo')
  }

  if (!args.includes('--no-refresh')) await refresh([])
  finish('scan', found)
}

async function refresh (args) {
  const all = args.includes('--all')
  const posts = Object.values(db.posts).filter(p => p.status !== 'descartado' && !p.manual && (all || due(p)))
  for (const p of posts) {
    try {
      const fresh = p.platform === 'youtube' ? await ytVideo(p.id) : p.platform === 'tiktok' ? await tiktokVideo(p.url) : null
      if (fresh) updateStats(p, fresh)
    } catch (e) { console.error('  no se pudo actualizar', p.platform, p.id, e.message) }
  }
  if (posts.length) log(`Visitas actualizadas: ${posts.length}`)
}

async function add (args) {
  const url = args[0]
  if (!url) return console.log('Uso: add <link> [--views N] [--likes N]')
  const num = flag => args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : undefined
  let post
  if (/youtu\.?be/.test(url)) post = await ytVideo(url.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/)[1])
  else if (/tiktok\.com/.test(url)) post = await tiktokVideo(url)
  else if (/instagram\.com/.test(url)) post = instagramPost(url, num('--views'), num('--likes'))
  else if (/bilibili\.com/.test(url)) post = { platform: 'bilibili', id: url.match(/BV\w+/)[0], url, author: '', title: '', date: '', views: num('--views') || 0, manual: true }
  if (!post) return console.log('No reconozco ese link.')
  const k = key(post.platform, post.id)
  delete db.rejected[k]
  if (db.posts[k]) updateStats(db.posts[k], post)
  else record(post, 'ok', 'agregado a mano', 'manual')
  if (num('--views')) db.posts[k].views = num('--views')
  if (args.includes('--title')) db.posts[k].title = args[args.indexOf('--title') + 1]
  if (args.includes('--thumb')) db.posts[k].thumbUrl = args[args.indexOf('--thumb') + 1]
  finish('add', [db.posts[k]])
}

// Links found by hand or in a logged-in browser search: verify them with the same rules as `scan`.
// Takes links as arguments or a text file with one link per line.
async function check (args) {
  const urls = args.flatMap(a => fs.existsSync(a) ? fs.readFileSync(a, 'utf8').split(/\s+/) : [a]).filter(u => /^https?:/.test(u))
  const found = []
  for (const url of new Set(urls)) {
    try {
      const post = /tiktok\.com/.test(url) ? await tiktokVideo(url) : /youtu\.?be/.test(url) ? await ytVideo(url.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/)[1]) : null
      if (!post) { console.log('  no sé revisar este link solo:', url); continue }
      const k = key(post.platform, post.id)
      if (db.posts[k]) { updateStats(db.posts[k], post); continue }
      const { verdict, reason } = classify([post.title, post.desc].join(' '), post.author)
      const entry = record(post, verdict, reason, 'link')
      if (entry) found.push(entry)
      else console.log(`  descartado (${reason}): ${post.author} — ${post.title.slice(0, 70)}`)
    } catch (e) { console.error('  falló', url, e.message) }
  }
  finish('check', found)
}

function setStatus (args) {
  const [ref, status] = args
  const valid = ['nuevo', 'aprobado', 'descartado', 'revisar', 'en-sitio']
  if (!valid.includes(status)) return console.log('Estados: ' + valid.join(', '))
  const k = Object.keys(db.posts).find(k => k === ref || k.endsWith(':' + ref))
  if (!k) return console.log('No encuentro', ref)
  db.posts[k].status = status
  finish('set', [])
}

// Re-applies the current rules to posts still waiting for review (after editing config.json).
function recheck () {
  let dropped = 0
  for (const [k, p] of Object.entries(db.posts)) {
    if (p.status !== 'revisar') continue
    const { verdict, reason } = classify([p.title, p.desc, p.tags].join(' '), p.author)
    if (verdict === 'reject') { delete db.posts[k]; db.rejected[k] = today(); dropped++ } else { p.status = verdict === 'ok' ? 'nuevo' : 'revisar'; p.reason = reason }
  }
  // Creators added only because of a post that is now rejected go too.
  const authors = new Set(Object.values(db.posts).map(p => p.platform + handleOf(p.author)))
  const before = creators.length
  creators.splice(0, creators.length, ...creators.filter(c => c.jestr !== null || authors.has(c.platform + handleOf(c.handle))))
  console.log(`Descartados ${dropped} posts y ${before - creators.length} creadores.`)
  finish('recheck', [])
}

function creatorCmd (args) {
  const [handle, ...rest] = args
  if (!handle) return console.log('Uso: creator <@handle> [--jestr|--no-jestr] [--platform youtube|tiktok|instagram] [--tiktok @x] [--instagram @x] [--no-watch]')
  const platform = rest.includes('--platform') ? rest[rest.indexOf('--platform') + 1] : 'youtube'
  let c = creators.find(c => handleOf(c.handle) === handleOf(handle) && c.platform === platform)
  if (!c) creators.push(c = { platform, handle, jestr: null, added: today() })
  if (rest.includes('--jestr')) c.jestr = true
  if (rest.includes('--no-jestr')) c.jestr = false
  if (rest.includes('--no-watch')) c.watch = false
  for (const p of ['tiktok', 'instagram']) if (rest.includes('--' + p)) c[p] = rest[rest.indexOf('--' + p) + 1]
  finish('creator', [])
}

// Card label: the caption's first sentence, without hashtags or emoji clutter.
function shortTitle (text) {
  const clean = (text || '').replace(/#\S+/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  const first = clean.split(/(?<=[.!?])\s|\s[—|]\s/)[0].replace(/^[^\p{L}\p{N}¡¿]+/u, '').trim()
  return first.length > 80 ? first.slice(0, 77).replace(/\s\S*$/, '') + '…' : first
}

// TikTok and Instagram image links expire, so their thumbnails are saved next to community.json.
async function saveThumb (p) {
  let url = p.thumbUrl
  if (p.platform === 'tiktok') {
    const html = await get(p.url)
    const own = html.slice(Math.max(0, html.indexOf(`"id":"${p.id}"`)))
    url = JSON.parse('"' + (own.match(/"cover":"((?:[^"\\]|\\.)*)"/)?.[1] || '') + '"')
  }
  if (!url) throw new Error('sin miniatura (usa add --thumb <url>)')
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error('miniatura ' + res.status)
  const tmp = path.join(DIR, '.thumb.tmp')
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  const name = `${p.platform}-${p.id}.jpg`
  const out = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-vf', 'scale=540:-2', '-q:v', '4', path.join(path.dirname(SITE_JSON), name)])
  fs.rmSync(tmp, { force: true })
  if (out.status !== 0) throw new Error('ffmpeg: ' + out.stderr)
  return name
}

// Adds approved posts to the site's carousel, copies fresh numbers over and sorts by views.
async function site () {
  const list = JSON.parse(fs.readFileSync(SITE_JSON, 'utf8'))
  let changed = 0
  for (const item of list) {
    const p = db.posts[key(item.platform, item.id)]
    if (!p) continue
    // The site also refreshes itself every 6 hours, so keep whichever count is higher.
    if (p.views > (item.views || 0)) { item.views = p.views; changed++ }
    if (p.likes > (item.likes || 0)) item.likes = p.likes
    if (item.views > p.views) p.views = item.views
  }
  const onSite = new Set(list.map(i => key(i.platform, i.id)))
  let added = 0
  for (const [k, p] of Object.entries(db.posts)) {
    if (p.status !== 'aprobado' || onSite.has(k)) continue
    const item = { platform: p.platform, id: p.id }
    // Only real Shorts open at /shorts/; other videos redirect, and their cards stay 16:9.
    if (p.platform === 'youtube' && (await fetch('https://www.youtube.com/shorts/' + p.id, { headers: H, redirect: 'manual' })).status === 200) item.vertical = true
    item.author = p.author
    if (p.platform === 'instagram') item.url = p.url
    item.title = shortTitle(p.title || p.desc)
    try {
      if (p.platform !== 'youtube') item.thumb = await saveThumb(p)
    } catch (e) { console.error(`  ${p.author}: ${e.message}, no lo agrego`); continue }
    item.views = p.views
    if (p.likes) item.likes = p.likes
    list.push(item)
    p.status = 'en-sitio'
    added++
    console.log(`  + ${p.platform} ${p.author} ${fmt(p.views)} — ${item.title}`)
  }
  list.sort((a, b) => (b.views || 0) - (a.views || 0))
  fs.writeFileSync(SITE_JSON, '[\n' + list.map(i => '  ' + JSON.stringify(i).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }')).join(',\n') + '\n]\n')
  console.log(`Sitio: ${added} posts agregados, ${changed} visitas actualizadas, ${list.length} en el carrusel.`)
  finish('site', [])
}

// One-time import of what is already on the site, so the first scan doesn't re-find it.
function seed () {
  const list = JSON.parse(fs.readFileSync(SITE_JSON, 'utf8'))
  for (const i of list) {
    const k = key(i.platform, i.id)
    if (db.posts[k]) continue
    db.posts[k] = {
      platform: i.platform,
      id: i.id,
      url: i.url || { youtube: `https://www.youtube.com/watch?v=${i.id}`, tiktok: `https://www.tiktok.com/${i.author}/video/${i.id}` }[i.platform] || '',
      author: i.author,
      title: i.title,
      date: '',
      views: i.views || 0,
      likes: i.likes,
      status: 'en-sitio',
      reason: 'ya estaba en el sitio',
      source: 'sitio',
      manual: i.platform === 'instagram' || undefined,
      firstSeen: today(),
      checked: '',
      history: [[today(), i.views || 0]]
    }
    if (i.author && !creatorFor(i.platform, i.author)) creators.push({ platform: i.platform, handle: i.author, jestr: null, added: today() })
  }
  finish('seed', [])
}

// ---------- Output ----------

const fmt = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e4 ? Math.round(n / 1e3) + ' mil' : n.toLocaleString('es-CL')
const log = s => console.log('· ' + s)
const jestrLabel = p => { const c = creatorFor(p.platform, p.author); return c?.jestr === true ? 'Jestr' : c?.jestr === false ? 'orgánico' : '?' }

function writeReport () {
  const posts = Object.values(db.posts).filter(p => p.status !== 'descartado')
  const row = p => `| ${p.platform} | [${p.author || '—'}](${p.url}) | ${(p.title || '').replace(/\|/g, '/').slice(0, 70)} | ${fmt(p.views)} | ${growth(p)} | ${p.date || '—'} | ${jestrLabel(p)}${p.paid ? ' · pagado' : ''} | ${p.status} |`
  const head = '| Red | Creador | Título | Visitas | +24h | Fecha | Origen | Estado |\n|---|---|---|---:|---:|---|---|---|'
  const byViews = [...posts].sort((a, b) => b.views - a.views)
  const groups = { Jestr: [], orgánico: [], '?': [] }
  for (const p of posts) groups[jestrLabel(p)].push(p)
  const sum = l => l.reduce((s, p) => s + (p.views || 0), 0)
  const manual = posts.filter(p => p.manual)
  const md = [
    `# Radar DUNK — ${today()}`,
    '',
    `${posts.length} posts · ${fmt(sum(posts))} visitas en total · ${new Set(posts.map(p => p.author)).size} creadores`,
    '',
    '| Origen | Posts | Visitas |\n|---|---:|---:|',
    ...Object.entries(groups).map(([g, l]) => `| ${g === '?' ? 'sin marcar' : g} | ${l.length} | ${fmt(sum(l))} |`),
    '',
    '## Para revisar', '', head, ...posts.filter(p => p.status === 'revisar').map(row), '',
    '## Nuevos', '', head, ...posts.filter(p => p.status === 'nuevo').sort((a, b) => b.views - a.views).map(row), '',
    '## Todos por visitas', '', head, ...byViews.map(row), '',
    manual.length ? `## Revisar a mano (Instagram y otros sin visitas automáticas)\n\n${manual.map(p => `- [${p.author}](${p.url}) — ${fmt(p.views)} (último dato ${p.history.at(-1)[0]})`).join('\n')}\n` : ''
  ].join('\n')
  fs.writeFileSync(path.join(DIR, 'report.md'), md)
  const csv = ['platform,author,origin,paid,status,views,likes,date,first_seen,url,title',
    ...byViews.map(p => [p.platform, p.author, jestrLabel(p), p.paid ? 'yes' : '', p.status, p.views, p.likes ?? '', p.date, p.firstSeen, p.url, '"' + (p.title || '').replace(/"/g, '""') + '"'].join(','))].join('\n')
  fs.writeFileSync(path.join(DIR, 'posts.csv'), '﻿' + csv + '\n')
}

function growth (p) {
  const h = p.history || []
  const prev = [...h].reverse().find(([d]) => daysSince(d) >= 0.9)
  return prev && h.length > 1 ? '+' + fmt(p.views - prev[1]) : ''
}

function finish (command, found) {
  db.runs = [...(db.runs || []).slice(-49), { date: new Date().toISOString(), command, found: found.length, requests: stats.requests, kb: Math.round(stats.bytes / 1024) }]
  save(FILES.db, db)
  save(FILES.creators, creators)
  writeReport()
  for (const p of found) console.log(`  ${p.status === 'nuevo' ? '★' : '?'} ${p.platform} ${p.author} ${fmt(p.views)} — ${p.title}${p.paid ? ' [pagado]' : ''}`)
  if (command === 'scan') console.log(`Encontrados: ${found.length}. ${stats.requests} pedidos, ${(stats.bytes / 1048576).toFixed(1)} MB. Informe: tools/radar/report.md`)
}

const help = `Radar DUNK
  scan [--only youtube,creators,related,bilibili] [--no-refresh]   buscar posts nuevos y actualizar visitas
  refresh [--all]                     solo actualizar visitas (las que tocan según antigüedad)
  add <link> [--views N] [--likes N] [--title "..."] agregar un post a mano (TikTok e Instagram van así)
  check <links o archivo.txt>         verificar links encontrados a mano (TikTok, YouTube)
  set <id> <estado>                   nuevo | aprobado | descartado | revisar | en-sitio
  recheck                             volver a aplicar las reglas a lo que está "para revisar"
  creator <@handle> [--jestr|--no-jestr] [--platform p] [--tiktok @x] [--instagram @x] [--no-watch]
  site                                pasar visitas al carrusel y listar aprobados que faltan
  seed                                importar lo que ya está en el sitio (una vez)
  report                              regenerar report.md y posts.csv`

const [cmd, ...args] = process.argv.slice(2)
const commands = { scan, refresh: async a => { await refresh(a); finish('refresh', []) }, add, check, set: setStatus, recheck, creator: creatorCmd, site, seed, report: () => finish('report', []) }
if (!commands[cmd]) console.log(help)
else await commands[cmd](args)
