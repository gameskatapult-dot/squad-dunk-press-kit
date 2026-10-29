#!/usr/bin/env node
// DUNK press radar: finds articles written about DUNK and lists them on the site. No dependencies.
// Usage: node tools/radar/press.mjs <command>   (see `help`)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SITE_DIR = path.join(DIR, '../../pages/community')
const SITE_JSON = path.join(SITE_DIR, 'press.json')
const THUMBS = path.join(SITE_DIR, 'press')
// Unlisted team panel (not linked anywhere on the site).
const PANEL_JSON = path.join(SITE_DIR, 'panel-yhqdojqq/press.json')
const DB = path.join(DIR, 'press-db.json')

const config = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'))
const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : { articles: {}, rejected: {}, runs: [] }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
const today = () => new Date().toISOString().slice(0, 10)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const stats = { requests: 0, bytes: 0 }

const strongRe = new RegExp(config.strong.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
const gameRe = new RegExp(config.gameWords, 'i')
const excludeRe = new RegExp(config.exclude, 'i')
// Headlines name the game with a capital: "DUNK", "Dunk", or the Korean, Japanese, Russian and Chinese spellings.
const namedRe = /\bDUNK\b|\bDunk\b|덩크|ダンク|Данк|扣篮/
const basketRe = /basket|baloncesto|basquete|баскетбол|バスケ|농구|篮球|first[- ]person|primera persona|primeira pessoa|от первого лица|一人称|1인칭|第一人称/i
// Own pages, video sites and browser-game portals (their "Dunk ..." games show up in searches) are not articles.
const notArticle = /(^|\.)(dunkthegame\.com|squaddunk\.com|steampowered\.com|steamcommunity\.com|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|bilibili\.com|x\.com|twitter\.com|reddit\.com|facebook\.com|frvr\.com|poki\.com|crazygames\.com)$/i

async function get (url, opts = {}) {
  await sleep(opts.delay ?? 400)
  const res = await fetch(url, { redirect: 'follow', ...opts, headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.8', ...opts.headers } })
  const text = await res.text()
  stats.requests++
  stats.bytes += text.length
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`)
  return { text, url: res.url }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»' }
const unescape = s => (s || '').replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(n))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m).trim()
const tag = (xml, t) => unescape((xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1])
const items = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1])
const dateOf = d => { const t = Date.parse(d); return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10) }

// One article, one key: no tracking params, no language folder (gamemeca.com/en/view.php?gid=1 = gamemeca.com/view.php?gid=1).
function keyOf (url) {
  const u = new URL(url)
  for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ocid|oc$|ref$|amp$)/i.test(p)) u.searchParams.delete(p)
  const p = u.pathname.replace(/\/(en|es|pt|ru|ja|ko|zh|de|fr|it)(-[a-z]{2,4})?(?=\/)/i, '').replace(/\/amp(?=\/|$)/i, '').replace(/\/$/, '')
  return u.hostname.replace(/^(www|m|amp)\./, '').toLowerCase() + p + (u.searchParams.size ? '?' + u.searchParams : '')
}
const idOf = k => crypto.createHash('sha1').update(k).digest('hex').slice(0, 10)
const known = url => { try { const k = keyOf(url); return db.articles[k] || db.rejected[k] } catch { return true } }

// ---------- Sources ----------

// Google News region for each search language.
const GN = { en: ['en-US', 'US', 'US:en'], es: ['es-419', 'MX', 'MX:es-419'], pt: ['pt-BR', 'BR', 'BR:pt-419'], ru: ['ru', 'RU', 'RU:ru'], de: ['de', 'DE', 'DE:de'], fr: ['fr', 'FR', 'FR:fr'], it: ['it', 'IT', 'IT:it'], ja: ['ja', 'JP', 'JP:ja'], ko: ['ko', 'KR', 'KR:ko'], zh: ['zh-CN', 'CN', 'CN:zh-Hans'] }

async function googleNews (q, lang) {
  const [hl, gl, ceid] = GN[lang]
  const { text } = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`)
  return items(text).map(i => ({
    gid: (tag(i, 'link').match(/articles\/([\w-]+)/) || [])[1],
    // Google appends " - Outlet" to every headline.
    title: tag(i, 'title').replace(/\s+-\s+[^-]+$/, ''),
    outlet: tag(i, 'source'),
    date: dateOf(tag(i, 'pubDate')),
    lang,
    source: 'google: ' + q
  }))
}

// Google News links are encoded; this asks Google for the publisher's URL (two small requests).
async function googleResolve (gid) {
  const page = (await get(`https://news.google.com/rss/articles/${gid}`)).text
  const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1]
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1]
  if (!sg || !ts) return null
  const req = [[['Fbv4je', `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${gid}",${ts},"${sg}"]`, null, 'generic']]]
  const { text } = await get('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: 'f.req=' + encodeURIComponent(JSON.stringify(req))
  })
  const m = text.match(/garturlres\\",\\"(.+?)\\"/)
  return m ? JSON.parse('"' + m[1].replace(/\\\\/g, '\\') + '"') : null
}

async function bingNews (q, mkt) {
  const { text } = await get(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=${mkt}&qft=sortbydate%3d%221%22`)
  return items(text).map(i => {
    const link = tag(i, 'link')
    return {
      url: decodeURIComponent((link.match(/[?&]url=([^&]+)/) || [])[1] || link),
      title: tag(i, 'title'),
      outlet: tag(i, 'News:Source'),
      date: dateOf(tag(i, 'pubDate')),
      lang: mkt.slice(0, 2),
      source: 'bing: ' + q
    }
  })
}

// Outlets syndicated on the game's Steam news page. They are attached to our app, so they count as confirmed.
async function steamNews () {
  const { text } = await get(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${config.press.steamApp}&count=50`)
  const out = []
  for (const n of JSON.parse(text).appnews?.newsitems || []) {
    if (n.feedname === 'steam_community_announcements' || !n.is_external_url) continue
    const res = await fetch(encodeURI(n.url), { redirect: 'manual', headers: { 'user-agent': UA } }).catch(() => null)
    const url = res?.headers.get('location')
    if (url) out.push({ url, title: n.title, outlet: n.feedlabel.replace(/\s+-\s+.*$/, ''), date: new Date(n.date * 1000).toISOString().slice(0, 10), source: 'steam', steam: true })
  }
  return out
}

// ---------- Reading an article ----------

function meta (html, ...names) {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, 'i')
    const m = html.match(re)?.[0]
    const content = m?.match(/content=["']([^"']*)["']/i)?.[1]
    if (content) return unescape(content)
  }
  return ''
}

// Language from the words themselves: blog templates often declare lang="en" whatever the text is.
function detectLang (text, fallback) {
  if (/[가-힯]/.test(text)) return 'ko'
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[一-鿿]/.test(text)) return 'zh'
  if (/[Ѐ-ӿ]/.test(text)) return 'ru'
  const words = {
    en: /\b(the|and|with|for|game|is|of|to|you)\b/gi,
    es: /\b(el|los|las|del|con|para|juego|una|que|presentan|baloncesto)\b/gi,
    pt: /\b(o|os|do|da|com|para|jogo|uma|é|anuncia|basquete|não)\b/gi,
    fr: /\b(le|les|du|des|avec|pour|jeu|une|est|et)\b/gi,
    de: /\b(der|die|das|und|mit|für|spiel|ein|ist)\b/gi,
    it: /\b(il|gli|della|con|per|gioco|una|è|di)\b/gi
  }
  const score = Object.entries(words).map(([l, re]) => [l, (text.match(re) || []).length]).sort((a, b) => b[1] - a[1])
  return score[0][1] >= 2 ? score[0][0] : fallback
}

async function readArticle (url) {
  const { text: html, url: finalUrl } = await get(url, { delay: 600 })
  const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]
  // The canonical link merges AMP, mobile and tracking variants of the same page.
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0].match(/href=["']([^"']+)["']/i) || [])[1] || meta(html, 'og:url')
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  // Some outlets leave markup in the headline ("<em>DUNK</em> brings…").
  const title = (meta(html, 'og:title', 'twitter:title') || unescape(tag(html, 'title'))).replace(/<[^>]+>/g, '')
  const desc = meta(html, 'og:description', 'description', 'twitter:description').slice(0, 300)
  return {
    url: /^https?:\/\//.test(canonical) ? unescape(canonical) : finalUrl,
    title,
    desc,
    outlet: meta(html, 'og:site_name', 'application-name'),
    image: meta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'),
    date: dateOf(meta(html, 'article:published_time', 'datePublished', 'pubdate', 'date') || ld || ''),
    lang: detectLang(title + ' ' + desc, (html.match(/<html[^>]+lang=["']?([a-z]{2})/i) || [])[1]?.toLowerCase()),
    html,
    text: unescape(body).slice(0, 20000)
  }
}

// Headlines often end in " - Outlet" or " | Outlet".
function cleanTitle (title, outlet, host) {
  const norm = s => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const parts = title.split(/\s+[|–—-]\s+/)
  const last = norm(parts.at(-1))
  const owner = norm(outlet) + ' ' + norm(host)
  if (parts.length > 1 && last && (owner.includes(last) || norm(outlet).includes(last) || last.includes(norm(outlet).slice(0, 6)))) parts.pop()
  return parts.join(' - ').replace(/\s+\|\s+[^|]+$/, m => owner.includes(norm(m)) ? '' : m).trim()
}

// ok: names the studio, the Steam app or the site. review: "DUNK" + basketball + game words. reject: the rest.
function classify (title, page) {
  if (/\b(official|announcement|oficial)\b[^\n]{0,30}\btrailer\b/i.test(title) && !/\b(review|preview|hands[- ]on|impressions)\b/i.test(title)) return { verdict: 'reject', reason: 'solo el trailer' }
  if (strongRe.test(page.html)) return { verdict: 'ok', reason: (page.html.match(strongRe) || [])[0] }
  if (excludeRe.test(title)) return { verdict: 'reject', reason: 'excluido: ' + (title.match(excludeRe) || [])[0] }
  const text = title + ' ' + page.text
  if (namedRe.test(title) && basketRe.test(text) && gameRe.test(text)) return { verdict: 'review', reason: 'DUNK + basket + juego' }
  return { verdict: 'reject', reason: 'no habla de DUNK' }
}

// Cheap check on the headline alone, before spending requests on the page.
// Links checked by hand have no headline yet, so they are always opened.
const worthOpening = c => c.steam || !c.title || strongRe.test(c.title) || (namedRe.test(c.title) && !excludeRe.test(c.title))

function hostOf (url) { return new URL(url).hostname.replace(/^www\./, '') }

function record (c, page, verdict, reason) {
  const k = keyOf(page.url)
  if (verdict === 'reject') { db.rejected[k] = today(); return null }
  // Display names: config.press.outlets fixes the odd ones; "gamebiz【ゲームビズ】" becomes "gamebiz".
  const outlet = config.press.outlets?.[hostOf(page.url)] || (c.outlet || page.outlet || hostOf(page.url)).replace(/\s*【[^】]*】\s*/g, '').trim()
  const entry = {
    id: idOf(k),
    url: page.url.replace(/[?&]utm_[^&#]+/g, '').replace(/#.*$/, ''),
    outlet,
    host: hostOf(page.url),
    title: cleanTitle(page.title || c.title, outlet, hostOf(page.url)),
    desc: page.desc || undefined,
    image: page.image || undefined,
    lang: page.lang || c.lang || undefined,
    date: page.date || c.date || today(),
    status: verdict === 'ok' ? 'nuevo' : 'revisar',
    reason,
    source: c.source,
    firstSeen: today()
  }
  db.articles[k] = entry
  return entry
}

async function consider (c, found) {
  if (c.date && c.date < config.since) return
  if (!worthOpening(c)) return
  try {
    if (!c.url && c.gid) {
      if (db.rejected['gn:' + c.gid]) return
      c.url = await googleResolve(c.gid)
      if (!c.url) return
      db.rejected['gn:' + c.gid] = today()
    }
    if (known(c.url) || notArticle.test(hostOf(c.url))) return
    const page = await readArticle(c.url)
    if (known(page.url)) { db.rejected[keyOf(c.url)] = today(); return }
    const { verdict, reason } = c.steam ? { verdict: 'ok', reason: 'noticias de Steam' } : classify(c.title || page.title, page)
    const entry = record(c, page, verdict, reason)
    if (entry) found.push(entry)
  } catch (e) { console.error('  no se pudo leer', c.url || c.gid, e.message) }
}

// ---------- Commands ----------

async function scan (args) {
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
  const use = s => !only || only.includes(s)
  const found = []
  const seen = new Set()
  const run = async (label, fetchList) => {
    try {
      for (const c of await fetchList()) {
        // The same story shows up in several searches; open it once per run.
        const id = c.gid || c.url
        if (seen.has(id)) continue
        seen.add(id)
        await consider(c, found)
      }
    } catch (e) { console.error('  falló', label, e.message) }
  }
  if (use('steam')) await run('steam', steamNews)
  if (use('bing')) for (const [q, mkt] of config.press.bing) await run('bing ' + q, () => bingNews(q, mkt))
  if (use('google')) for (const [q, lang] of config.press.google) await run('google ' + q, () => googleNews(q, lang))
  finish('scan', found)
}

async function add (args) {
  const url = args[0]
  if (!/^https?:/.test(url || '')) return console.log('Uso: add <link> [--outlet "Medio"] [--title "..."]')
  const opt = f => args.includes(f) ? args[args.indexOf(f) + 1] : undefined
  const page = await readArticle(url)
  const k = keyOf(page.url)
  delete db.rejected[k]
  const entry = db.articles[k] || record({ source: 'manual', lang: undefined }, page, 'ok', 'agregado a mano')
  entry.status = 'aprobado'
  if (opt('--outlet')) entry.outlet = opt('--outlet')
  if (opt('--title')) entry.title = opt('--title')
  finish('add', [entry])
}

// Links found by hand: checked with the same rules as `scan`.
async function check (args) {
  const urls = args.flatMap(a => fs.existsSync(a) ? fs.readFileSync(a, 'utf8').split(/\s+/) : [a]).filter(u => /^https?:/.test(u))
  const found = []
  for (const url of new Set(urls)) {
    if (known(url)) { console.log('  ya estaba:', url); continue }
    const before = found.length
    await consider({ url, title: '', source: 'link' }, found)
    if (found.length === before) console.log('  descartado:', url)
  }
  finish('check', found)
}

const find = ref => Object.keys(db.articles).find(k => db.articles[k].id === ref || k === ref || db.articles[k].url === ref)

function setStatus (args) {
  const [ref, status] = args
  const valid = ['nuevo', 'aprobado', 'descartado', 'revisar', 'en-sitio']
  if (!valid.includes(status)) return console.log('Estados: ' + valid.join(', '))
  const k = find(ref)
  if (!k) return console.log('No encuentro', ref)
  db.articles[k].status = status
  finish('set', [])
}

// "nuevo" = names the studio or the Steam app: safe to publish without a look. Used by the daily task.
function approve () {
  const list = Object.values(db.articles).filter(a => a.status === 'nuevo')
  for (const a of list) a.status = 'aprobado'
  console.log(`Aprobados ${list.length} artículos.`)
  finish('approve', [])
}

// Article images are saved next to press.json: outlets often block hotlinking or move them.
async function saveThumb (a) {
  if (!a.image) return null
  const name = `press/${a.id}.jpg`
  if (fs.existsSync(path.join(SITE_DIR, name))) return name
  const res = await fetch(new URL(a.image, a.url), { headers: { 'user-agent': UA, referer: a.url } })
  if (!res.ok) throw new Error('imagen ' + res.status)
  fs.mkdirSync(THUMBS, { recursive: true })
  const tmp = path.join(DIR, '.press.tmp')
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  const out = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', path.join(SITE_DIR, name)])
  fs.rmSync(tmp, { force: true })
  if (out.status !== 0) throw new Error('ffmpeg: ' + out.stderr)
  return name
}

// Writes press.json with every approved article, newest first.
async function site () {
  let added = 0
  for (const a of Object.values(db.articles)) {
    if (!['aprobado', 'en-sitio'].includes(a.status)) continue
    if (!a.thumb && a.image) {
      try { a.thumb = await saveThumb(a) } catch (e) { console.error(`  ${a.outlet}: ${e.message} (va sin imagen)`) }
    }
    if (a.status === 'aprobado') { a.status = 'en-sitio'; added++; console.log(`  + ${a.outlet} (${a.lang || '?'}) — ${a.title}`) }
  }
  const list = Object.values(db.articles)
    .filter(a => a.status === 'en-sitio')
    .sort((a, b) => b.date.localeCompare(a.date) || a.outlet.localeCompare(b.outlet))
    .map(a => ({ id: a.id, url: a.url, outlet: a.outlet, title: a.title, date: a.date, lang: a.lang, thumb: a.thumb }))
  fs.writeFileSync(SITE_JSON, '[\n' + list.map(i => '  ' + JSON.stringify(i)).join(',\n') + '\n]\n')
  console.log(`Sitio: ${added} artículos nuevos, ${list.length} en total.`)
  finish('site', [])
}

// ---------- Output ----------

function writeReport () {
  const all = Object.values(db.articles).sort((a, b) => b.date.localeCompare(a.date))
  const row = a => `| ${a.date} | ${a.outlet} | [${(a.title || '').replace(/\|/g, '/').slice(0, 90)}](${a.url}) | ${a.lang || '—'} | ${a.reason} | ${a.status} | \`${a.id}\` |`
  const head = '| Fecha | Medio | Título | Idioma | Por qué | Estado | id |\n|---|---|---|---|---|---|---|'
  const md = [
    `# Prensa DUNK — ${today()}`,
    '',
    `${all.filter(a => a.status !== 'descartado').length} artículos · ${all.filter(a => a.status === 'en-sitio').length} en el sitio · ${new Set(all.map(a => a.lang)).size} idiomas`,
    '',
    '## Para revisar', '', head, ...all.filter(a => a.status === 'revisar').map(row), '',
    '## Nuevos (sin publicar)', '', head, ...all.filter(a => ['nuevo', 'aprobado'].includes(a.status)).map(row), '',
    '## En el sitio', '', head, ...all.filter(a => a.status === 'en-sitio').map(row), ''
  ].join('\n')
  fs.writeFileSync(path.join(DIR, 'press-report.md'), md)
  writePanel(all)
}

// Every article the radar kept, for the team panel, including those waiting for review.
function writePanel (all) {
  if (!fs.existsSync(path.dirname(PANEL_JSON))) return
  const articles = all.map(a => ({ id: a.id, date: a.date, outlet: a.outlet, lang: a.lang || null, title: a.title, url: a.url, desc: a.desc || '', status: a.status, reason: a.reason, source: a.source, firstSeen: a.firstSeen, thumb: a.thumb || null }))
  fs.writeFileSync(PANEL_JSON, JSON.stringify({ updated: new Date().toISOString(), searches: config.press.google.length + config.press.bing.length + 1, articles }) + '\n')
}

function finish (command, found) {
  db.runs = [...(db.runs || []).slice(-49), { date: new Date().toISOString(), command, found: found.length, requests: stats.requests, kb: Math.round(stats.bytes / 1024) }]
  fs.writeFileSync(DB, JSON.stringify(db, null, 1) + '\n')
  writeReport()
  for (const a of found) console.log(`  ${a.status === 'revisar' ? '?' : '★'} ${a.date} ${a.outlet} (${a.lang || '?'}) — ${a.title}`)
  if (command === 'scan') console.log(`Encontrados: ${found.length}. ${stats.requests} pedidos, ${(stats.bytes / 1048576).toFixed(1)} MB. Informe: tools/radar/press-report.md`)
}

const help = `Prensa DUNK
  scan [--only steam,bing,google]   buscar artículos nuevos
  add <link> [--outlet "Medio"] [--title "..."]   agregar un artículo a mano (queda aprobado)
  check <links o archivo.txt>       verificar links encontrados a mano
  set <id> <estado>                 nuevo | aprobado | descartado | revisar | en-sitio
  approve                           aprobar todos los "nuevo" (nombran al estudio o el app de Steam)
  site                              escribir pages/community/press.json con lo aprobado
  report                            regenerar press-report.md`

const [cmd, ...args] = process.argv.slice(2)
const commands = { scan, add, check, set: setStatus, approve, site, report: () => finish('report', []) }
if (!commands[cmd]) console.log(help)
else await commands[cmd](args)
