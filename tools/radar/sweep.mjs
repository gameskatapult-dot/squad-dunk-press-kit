#!/usr/bin/env node
// Instagram/TikTok sweep that runs inside the user's logged-in Chrome tab, so a full check costs a few calls.
// Usage:
//   node tools/radar/sweep.mjs script ig|tt     print the code to run in an instagram.com / tiktok.com tab
//   node tools/radar/sweep.mjs apply <file>     save view counts and list candidates from the tab's result
//   node tools/radar/sweep.mjs accept <key...>  add candidates to the radar as approved (then run radar.mjs site)
//   node tools/radar/sweep.mjs reject <key...>  mark candidates as not DUNK so they never come back
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const load = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const save = (f, data) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(data, null, 1) + '\n')
const config = load('config.json')
const db = load('db.json')
const CANDS = 'sweep-candidates.json'
const live = p => ['aprobado', 'en-sitio'].includes(p.status)
const today = () => new Date().toISOString().slice(0, 10)

// Runs in the browser tab. Results land in window.__radar; seen non-DUNK posts are remembered in the tab's localStorage.
async function radarSweep (cfg) {
  const R = window.__radar
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const rx = s => new RegExp(s, 'i')
  const exclude = rx(cfg.exclude); const strong = rx(cfg.strong); const ball = rx(cfg.ball); const game = rx(cfg.game)
  const known = new Set(cfg.known)
  const since = Date.parse(cfg.since)
  const seenKey = 'dunkRadarSeen'
  const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]'))
  const out = { cands: [], counts: [], scanned: 0, checked: 0, errors: 0 }
  const verdict = (text, author, fromCreator) => {
    if (cfg.official.includes(author.toLowerCase()) || exclude.test(text)) return null
    if (strong.test(text) || /\bDUNK\b/.test(text)) return 'likely'
    if (ball.test(text) && (fromCreator || game.test(text))) return 'maybe'
    return null
  }
  const consider = (k, text, author, fromCreator, post) => {
    out.checked++
    const v = verdict(text, author, fromCreator || cfg.creators.includes(author.toLowerCase()))
    if (v) out.cands.push({ k, v, ...post, cap: text.slice(0, 140) })
    else seen.add(k)
  }

  if (cfg.platform === 'ig') {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const idOf = c => { let n = 0n; for (const ch of c.slice(0, 11)) n = n * 64n + BigInt(A.indexOf(ch)); return n }
    const timeOf = c => Number(idOf(c) >> 23n) + 1314220021721
    const info = async c => (await (await fetch('/api/v1/media/' + idOf(c) + '/info/', { headers: { 'x-ig-app-id': '936619743392459' } })).json()).items[0]
    const views = m => m.play_count || m.ig_play_count || 0
    const sel = 'a[href*="/p/"],a[href*="/reel/"]'
    const found = new Set()
    for (const [i, q] of cfg.phrases.entries()) {
      R.phase = `ig search ${i + 1}/${cfg.phrases.length}`
      // Instagram refuses iframes, but its router follows pushState, so this script keeps running between searches.
      history.pushState({}, '', '/explore/search/keyword/?q=' + encodeURIComponent(q))
      dispatchEvent(new PopStateEvent('popstate', { state: {} }))
      await sleep(1500)
      let last = 0; let stable = 0
      for (let t = 0; t < 14 && stable < 2; t++) {
        scrollTo(0, document.body.scrollHeight)
        await sleep(1500)
        const c = document.querySelectorAll(sel).length
        stable = c > 6 && c === last ? stable + 1 : 0
        last = c
      }
      document.querySelectorAll(sel).forEach(a => found.add(a.getAttribute('href').split('/').filter(Boolean).pop()))
    }
    out.scanned = found.size
    const todo = [...found].filter(c => c.length >= 11 && timeOf(c) > since && !known.has(c) && !seen.has('instagram:' + c))
    for (const [i, c] of todo.entries()) {
      R.phase = `ig check ${i + 1}/${todo.length}`
      try {
        const m = await info(c)
        const author = '@' + m.user.username
        consider('instagram:' + c, (m.caption?.text || '').replace(/\s+/g, ' ') + ' ' + author, author, false, {
          url: `https://www.instagram.com/${m.user.username}/reel/${c}/`, views: views(m), likes: m.like_count,
          date: new Date(m.taken_at * 1000).toISOString().slice(0, 10), vertical: m.original_height > m.original_width
        })
      } catch { out.errors++ }
      await sleep(350)
    }
    for (const [i, c] of cfg.track.entries()) {
      R.phase = `ig counts ${i + 1}/${cfg.track.length}`
      try { const m = await info(c); out.counts.push(`instagram:${c}:${views(m)},${m.like_count}`) } catch { out.errors++ }
      await sleep(200)
    }
  }

  if (cfg.platform === 'tt') {
    // TikTok allows same-origin iframes, so searches and profiles load in a hidden frame of this tab.
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;opacity:0.01;pointer-events:none;z-index:-1;border:0'
    document.body.appendChild(frame)
    const open = async p => { frame.src = p; await new Promise(resolve => { frame.onload = resolve; setTimeout(resolve, 15000) }); await sleep(2500) }
    const links = async scrolls => {
      const d = frame.contentDocument
      for (let i = 0; i < scrolls; i++) { d.scrollingElement?.scrollTo(0, d.body.scrollHeight); await sleep(1500) }
      return [...new Set([...d.querySelectorAll('a[href*="/video/"]')].map(a => a.href.split('?')[0]))]
    }
    const found = new Map()
    for (const [i, q] of cfg.phrases.entries()) {
      R.phase = `tt search ${i + 1}/${cfg.phrases.length}`
      try { await open('/search/video?q=' + encodeURIComponent(q)); for (const u of await links(5)) if (!found.has(u)) found.set(u, false) } catch { out.errors++ }
    }
    for (const [i, h] of cfg.handles.entries()) {
      R.phase = `tt profile ${i + 1}/${cfg.handles.length}`
      try { await open('/@' + h); for (const u of await links(1)) found.set(u, true) } catch { out.errors++ }
    }
    frame.remove()
    out.scanned = found.size
    const idOf = u => u.split('/').pop()
    const detail = async u => {
      const t = await (await fetch(u)).text()
      const m = t.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s)
      return JSON.parse(m[1]).__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct
    }
    const todo = [...found].filter(([u]) => /\/video\/\d+$/.test(u) && Number(BigInt(idOf(u)) >> 32n) * 1000 > since &&
      !known.has(idOf(u)) && !seen.has('tiktok:' + idOf(u)))
    for (const [i, [u, fromCreator]] of todo.entries()) {
      R.phase = `tt check ${i + 1}/${todo.length}`
      try {
        const d = await detail(u)
        const author = '@' + d.author.uniqueId
        consider('tiktok:' + idOf(u), d.desc.replace(/\s+/g, ' ') + ' ' + author, author, fromCreator, {
          url: `https://www.tiktok.com/${author}/video/${idOf(u)}`, views: d.stats.playCount, likes: d.stats.diggCount,
          date: new Date(d.createTime * 1000).toISOString().slice(0, 10), vertical: d.video.height > d.video.width
        })
      } catch { out.errors++ }
      await sleep(300)
    }
    for (const [i, p] of cfg.track.entries()) {
      R.phase = `tt counts ${i + 1}/${cfg.track.length}`
      try { const s = (await detail('/' + p)).stats; out.counts.push(`tiktok:${idOf(p)}:${s.playCount},${s.diggCount}`) } catch { out.errors++ }
      await sleep(250)
    }
  }

  localStorage.setItem(seenKey, JSON.stringify([...seen]))
  // Compact text, read back in short pages: the browser tool cuts long return values.
  const clean = s => String(s).replace(/[¦\n]/g, ' ')
  R.text = [`#${cfg.platform} ${out.scanned} ${out.checked} ${out.errors}`,
    ...out.cands.map(c => 'C ' + [c.k, c.v, c.views, c.likes, c.date, c.vertical ? 1 : 0, c.url, clean(c.cap.slice(0, 70))].join('¦')),
    'N ' + out.counts.map(s => s.slice(s.indexOf(':') + 1)).join(' ')].join('\n')
  R.page = i => R.text.slice(i * 900, (i + 1) * 900)
  return out
}

function script (platform) {
  const posts = Object.entries(db.posts)
  // Candidates still waiting for accept/reject are skipped too, so the next run does not check them again.
  const pending = fs.existsSync(path.join(DIR, CANDS)) ? load(CANDS).map(c => c.k) : []
  const prefix = platform === 'ig' ? 'instagram:' : 'tiktok:'
  const handles = [...new Set(posts.filter(([k, p]) => k.startsWith('tiktok:') && live(p)).map(([, p]) => p.author.replace(/^@/, '').toLowerCase()))]
  const cfg = {
    platform,
    since: config.sweep.since || config.since,
    phrases: config.sweep[platform],
    handles: platform === 'tt' ? handles : [],
    known: [...new Set([...posts.map(([k]) => k), ...Object.keys(db.rejected), ...pending].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)))],
    track: posts.filter(([k, p]) => k.startsWith(prefix) && live(p)).map(([, p]) => platform === 'ig' ? p.id : p.url.replace('https://www.tiktok.com/', '')),
    creators: [...new Set(posts.filter(([, p]) => live(p) && p.author).map(([, p]) => p.author.toLowerCase()))],
    official: config.official.map(h => h.toLowerCase()),
    exclude: config.exclude,
    strong: config.strong.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    game: config.sweep.game,
    ball: config.sweep.ball
  }
  // Comments and indentation are dropped: this text is pasted into the tab on every run.
  const code = radarSweep.toString().replace(/^\s*\/\/.*\n/gm, '').replace(/\n\s+/g, '\n')
  return `window.__radar={phase:'start'};(${code})(${JSON.stringify(cfg)}).then(r=>{window.__radar.result=r;window.__radar.phase='done'},e=>{window.__radar.phase='error: '+e.message});'started'`
}

// Same hourly history rule as radar.mjs, so the panel charts stay consistent.
function setCount (entry, views, likes) {
  const hour = new Date().toISOString().slice(0, 13) + ':00Z'
  if (views > (entry.views || 0)) entry.views = views
  if (likes > (entry.likes || 0)) entry.likes = likes
  entry.checked = today()
  const last = entry.history.at(-1)
  if (last[0] === hour) last[1] = entry.views
  else if (last[1] !== entry.views) entry.history.push([hour, entry.views])
}

// Reads the tab's R.text (its pages pasted together, in order).
function parse (text) {
  const lines = text.replace(/\r/g, '').split('\n')
  const [platform, scanned, checked, errors] = lines[0].slice(1).split(' ')
  const cands = lines.filter(l => l.startsWith('C ')).map(l => {
    const [k, v, views, likes, date, vertical, url, cap] = l.slice(2).split('¦')
    return { k, v, views: Number(views), likes: Number(likes), date, vertical: vertical === '1', url, cap }
  })
  const counts = lines.filter(l => l.startsWith('N ')).flatMap(l => l.slice(2).split(' ').filter(Boolean))
  return { prefix: platform === 'ig' ? 'instagram:' : 'tiktok:', scanned, checked, errors, cands, counts }
}

function apply (file) {
  const result = parse(fs.readFileSync(file, 'utf8'))
  let updated = 0
  for (const pair of result.counts) {
    const [id, nums] = pair.split(':')
    const [views, likes] = nums.split(',').map(Number)
    const entry = db.posts[result.prefix + id]
    if (entry) { setCount(entry, views, likes); updated++ }
  }
  save('db.json', db)
  const previous = fs.existsSync(path.join(DIR, CANDS)) ? load(CANDS) : []
  // One entry per key; a fresh result replaces the older one.
  const byKey = new Map()
  for (const c of [...previous, ...result.cands]) if (!db.posts[c.k] && !db.rejected[c.k]) byKey.set(c.k, c)
  save(CANDS, [...byKey.values()])
  console.log(`Escaneados ${result.scanned}, revisados ${result.checked}, errores ${result.errors}, visitas actualizadas ${updated}.`)
  for (const c of result.cands || []) console.log(`  ${c.v === 'likely' ? '★' : '?'} ${c.k} ${c.views} ${c.vertical ? '' : '[horizontal] '}${c.url} — ${c.cap.slice(0, 90)}`)
  if (!result.cands.length) console.log('  Sin candidatos nuevos.')
}

function accept (keys) {
  const cands = load(CANDS)
  const done = []
  for (const k of keys) {
    const c = cands.find(x => x.k === k)
    if (!c) { console.log('No está en la lista:', k); continue }
    const radar = (...a) => spawnSync(process.execPath, [path.join(DIR, 'radar.mjs'), ...a], { stdio: 'inherit' })
    const extra = c.k.startsWith('instagram:') ? ['--views', String(c.views), '--likes', String(c.likes), '--title', c.cap.split(' @')[0].slice(0, 80)] : []
    if (radar('add', c.url, ...extra).status !== 0 || !load('db.json').posts[c.k]) { console.log('No se pudo agregar, queda en la lista:', k); continue }
    radar('set', c.k, 'aprobado')
    done.push(k)
  }
  save(CANDS, cands.filter(c => !done.includes(c.k)))
}

// A post already on the site is only removed with --force, so a mistyped key cannot take it down.
function reject (args) {
  const force = args.includes('--force')
  const keys = []
  for (const k of args.filter(a => a !== '--force')) {
    if (!force && db.posts[k] && live(db.posts[k])) console.log('Está publicado, no se descarta (usar --force):', k)
    else keys.push(k)
  }
  for (const k of keys) { delete db.posts[k]; db.rejected[k] = today() }
  save('db.json', db)
  if (fs.existsSync(path.join(DIR, CANDS))) save(CANDS, load(CANDS).filter(c => !keys.includes(c.k)))
  console.log(`Descartados ${keys.length}.`)
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'script') process.stdout.write(script(args[0]) + '\n')
else if (cmd === 'apply') apply(args[0])
else if (cmd === 'accept') accept(args)
else if (cmd === 'reject') reject(args)
else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n'))
