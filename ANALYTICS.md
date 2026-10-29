# Analytics

The site uses GoatCounter (`https://katapultgames.goatcounter.com`, the same account and history as before the move to dunkthegame.com). There are no cookies. Everything below lives in `assets/js/presskit-page.js`.

## When GoatCounter loads

Both pages have `<meta name="goatcounter" content="https://katapultgames.goatcounter.com/count">`:

- Press kit: emitted by `assets/_includes/head.html` from `analytics.goatcounter_endpoint` in `content/squad-dunk.yml`.
- Home: written into `pages/root-redirect.html`.

`loadAnalytics()` only adds `count.js` when **all** of these are true:

- The host is exactly `dunkthegame.com` (`analyticsHosts`). Local builds, `*.github.io`, previews and any staging host send nothing. `www` 301-redirects to the apex, so it never renders.
- The browser is not automated (`navigator.webdriver`), so test runs aren't counted.

Then `count.js` itself also skips a browser in these cases:

- The browser has opted out. Open `https://dunkthegame.com/#toggle-goatcounter` once to turn counting off in that browser (it is stored in `localStorage.skipgc`); open it again to turn it back on.
- It is running on localhost or from `file:`.

## Pageviews

| Page | Path in GoatCounter |
|---|---|
| Home | `/` |
| Press kit (`/presskit/`, and the `/squad-dunk/` copy) | `/presskit/` |

The path comes from the canonical URL, so `?lang=` and campaign parameters never split a page into several rows. These are the same paths as before the domain move, so the history continues. GoatCounter reads the campaign from the query string of the page view (`utm_source`/`ref` as the source, `utm_campaign` as the campaign).

## Events

One delegated listener sends one event per activation: a left click, Enter, or a middle-click (`auxclick`). Right-clicks are not counted.

| Event (GoatCounter path) | What it measures |
|---|---|
| `Steam Click: home / hero` | "Wishlist on Steam" button on the home page |
| `Steam Click: presskit / topbar` | Small Steam button in the press kit top bar |
| `Steam Click: presskit / hero` | "Wishlist on Steam" button in the press kit intro |
| `Steam Click: presskit / factsheet` | Steam link in the factsheet (only when that row is shown) |
| `Press Kit View` | "View press kit" button (home → press kit, or the jump to the factsheet on the press kit) |
| `Press Kit Download` | "Download press kit" (Google Drive folder) |
| `Assets Download` | Screenshot zip download |
| `Contact Email Click` | Press email button or the email in the quick facts |
| `Trailer Play` | Plays the embedded trailer |
| `Trailer YouTube Click` | "Watch on YouTube" under the trailer |
| `Trailer Click` | Trailer / pre-view links in the factsheet |
| `Press Article Click` | A card in the Press section (opens the outlet's article) |
| `Language Changed` | Visitor picks a language (the language is in the title, but GoatCounter only shows the latest title per path) |

Until 2026-10-29 every Steam button sent a single `Steam Click` event. Adding up the `Steam Click: …` rows gives the same total.

Steam links are tagged with `data-analytics-placement`. A new Steam button needs that attribute (and `data-analytics-event="Steam Click"`) to be counted and UTM-tagged.

## Campaigns

Campaign parameters: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `ref`.

- **Landing:** campaign parameters in the URL are saved in `sessionStorage` (`dunk-campaign`) for that tab. A newer campaign in the URL replaces the saved one.
- **Moving around:** links between home and the press kit (`[data-language-link]`) get the campaign appended, so the next pageview is attributed too.
- **Changing language:** the query string is kept and `lang` is set.

### What Steam receives

Each Steam link is rewritten when the page loads:

| Steam parameter | Value |
|---|---|
| `utm_source` | visit's `utm_source`, else its `ref`, else `squaddunk` |
| `utm_medium` | visit's `utm_medium`, else `website` |
| `utm_campaign` | visit's `utm_campaign`, else `announcement` |
| `utm_term` | visit's `utm_term`, only if present |
| `utm_content` | always `<page>-<placement>`, e.g. `home-hero`, `presskit-topbar` |

The fallbacks are the values the site has always sent, so visits without a campaign keep reporting under the same Steam source and campaign. Only `utm_content` changes: it was `home` / `presskit` and is now split by button. A visitor's own `utm_content` is not passed to Steam, because that field identifies the button.

Example: `https://dunkthegame.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch_oct` → Steam gets `utm_source=newsletter&utm_medium=email&utm_campaign=launch_oct&utm_content=home-hero`.

## Languages and hreflang

There is no `hreflang`, on purpose. Every language is served from the same HTML, which is English. JavaScript swaps the text after loading `localization.json`, using `?lang=`, the saved choice or the browser language. The canonical of every `?lang=` variant points to the bare URL. So Google indexes one English page per URL and has no separate translated page to point `hreflang` at. Adding it would point at URLs that canonicalize elsewhere, and Google ignores that.

Add `hreflang` only if the translations are generated as their own static pages (for example `/es/presskit/`), each with a self-referencing canonical.
