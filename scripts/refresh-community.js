// Refreshes view and like counts in pages/community/community.json from the public
// YouTube and TikTok pages, then re-sorts by views. Instagram hides its counts from
// logged-out visitors, so those entries keep whatever was last entered by hand.
// A count is only replaced when the page clearly returned one; anything odd keeps the old value.

const fs = require('fs')
const path = require('path')

const listPath = path.resolve(__dirname, '..', 'pages', 'community', 'community.json')
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'CONSENT=YES+1'
}

const readers = {
  youtube: async (item) => {
    const html = await fetchText('https://www.youtube.com/watch?v=' + item.id)
    // Make sure the counts belong to this video and not to a consent or error page.
    if (!html.includes('"videoId":"' + item.id + '"')) return null
    return { views: match(html, /"viewCount":"(\d+)"/), likes: match(html, /"likeCount":"(\d+)"/) }
  },
  tiktok: async (item) => {
    const html = await fetchText('https://www.tiktok.com/' + item.author + '/video/' + item.id)
    const at = html.indexOf('"id":"' + item.id + '"')
    if (at === -1) return null
    const own = html.slice(at, at + 20000)
    return { views: match(own, /"playCount":(\d+)/), likes: match(own, /"diggCount":(\d+)/) }
  }
}

async function fetchText (url) {
  const response = await fetch(url, { headers, redirect: 'follow' })
  if (!response.ok) throw new Error(response.status + ' for ' + url)
  return response.text()
}

function match (text, pattern) {
  const found = text.match(pattern)
  return found ? Number(found[1]) : null
}

// Platforms round and recount, so allow small dips, but a big drop means a bad read.
function plausible (next, previous) {
  return Number.isFinite(next) && next > 0 && (!previous || next >= previous * 0.8)
}

function serialize (list) {
  const lines = list.map((item) => '  ' + JSON.stringify(item)
    .replace(/":/g, '": ')
    .replace(/,"/g, ', "')
    .replace(/^\{/, '{ ')
    .replace(/\}$/, ' }'))
  return '[\n' + lines.join(',\n') + '\n]\n'
}

async function main () {
  const original = fs.readFileSync(listPath, 'utf8')
  const list = JSON.parse(original)
  let updated = 0
  let failed = 0

  for (const item of list) {
    const read = readers[item.platform]
    if (!read) continue
    try {
      const counts = await read(item)
      if (!counts) throw new Error('no counts on the page')
      let changed = false
      for (const key of ['views', 'likes']) {
        if (plausible(counts[key], item[key]) && counts[key] !== item[key]) {
          item[key] = counts[key]
          changed = true
        }
      }
      if (changed) updated++
    } catch (error) {
      failed++
      console.warn(`! ${item.platform} ${item.id} (${item.author}): ${error.message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }

  list.sort((a, b) => (b.views || 0) - (a.views || 0))
  const output = serialize(list)
  if (output !== original) fs.writeFileSync(listPath, output)

  const total = list.reduce((sum, item) => sum + (item.views || 0), 0)
  console.log(`Updated ${updated} posts, ${failed} unreadable. Total views: ${total}.`)
  // Fail the run when nothing could be read at all, so a blocked runner is noticed.
  if (failed && failed === list.filter((item) => readers[item.platform]).length) process.exit(1)
}

main()
