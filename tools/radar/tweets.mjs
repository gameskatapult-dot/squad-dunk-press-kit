#!/usr/bin/env node
// DUNK fan tweets: builds the site's "what people are saying" belt from a hand-picked list. No dependencies.
// Usage: node tools/radar/tweets.mjs add <x.com status url> [--text "shorter quote"]
//        node tools/radar/tweets.mjs remove <id>
//        node tools/radar/tweets.mjs site
// Tweet text, name and avatar come from X's public embed endpoint (no login). Avatars are saved next to
// tweets.json so the site never hotlinks X.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SITE_DIR = path.join(DIR, '../../pages/community')
const SITE_JSON = path.join(SITE_DIR, 'tweets.json')
const AVATARS = path.join(SITE_DIR, 'tweets')
const LIST = path.join(DIR, 'tweets.json')

const list = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, 'utf8')) : []
const save = () => fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + '\n')

async function fetchTweet (id) {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=x`)
  if (!res.ok) throw new Error(`X respondió ${res.status}`)
  const t = await res.json()
  if (!t.user) throw new Error('tweet no disponible')
  // Drop the @mentions that open a reply, the trailing t.co link X appends for media, and HTML entities.
  const text = t.text.slice(0, t.display_text_range ? t.display_text_range[1] : undefined)
    .replace(/^(@\w+\s+)+/, '').replace(/\s*https:\/\/t\.co\/\S+$/, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
  return { id, name: t.user.name.split(' | ')[0].trim(), handle: t.user.screen_name, date: t.created_at.slice(0, 10), text, likes: t.favorite_count, avatarUrl: t.user.profile_image_url_https.replace('_normal.', '_200x200.') }
}

async function saveAvatar (tweet) {
  fs.mkdirSync(AVATARS, { recursive: true })
  const ext = path.extname(new URL(tweet.avatarUrl).pathname) || '.jpg'
  const name = tweet.handle.toLowerCase() + ext
  const res = await fetch(tweet.avatarUrl)
  if (!res.ok) throw new Error(`avatar ${res.status}`)
  fs.writeFileSync(path.join(AVATARS, name), Buffer.from(await res.arrayBuffer()))
  return 'tweets/' + name
}

async function add (url) {
  const id = (url.match(/status\/(\d+)/) || [])[1] || (/^\d+$/.test(url) ? url : null)
  if (!id) throw new Error('falta el link del tweet')
  const i = process.argv.indexOf('--text')
  const tweet = await fetchTweet(id)
  const entry = { id, url: `https://x.com/${tweet.handle}/status/${id}`, name: tweet.name, handle: tweet.handle, date: tweet.date, text: i > 0 ? process.argv[i + 1] : tweet.text, likes: tweet.likes, avatar: await saveAvatar(tweet) }
  const at = list.findIndex(t => t.id === id)
  if (at >= 0) list[at] = entry; else list.push(entry)
  save()
  console.log(`  + @${entry.handle} — ${entry.text}`)
}

function site () {
  const out = list.map(({ id, url, name, handle, date, text, avatar }) => ({ id, url, name, handle, date, text, avatar }))
  fs.writeFileSync(SITE_JSON, '[\n' + out.map(t => '  ' + JSON.stringify(t)).join(',\n') + '\n]\n')
  console.log(`Sitio: ${out.length} tweets.`)
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'add') await add(arg)
else if (cmd === 'remove') { const n = list.length; list.splice(0, n, ...list.filter(t => t.id !== arg)); save(); console.log(n === list.length ? 'no estaba' : 'quitado') }
else if (cmd === 'site') site()
else console.log('node tools/radar/tweets.mjs add <url> [--text "..."] | remove <id> | site')
