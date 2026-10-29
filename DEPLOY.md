# Deploying the Squad Dunk Press Kit to GitHub Pages

This press kit is generated with `pixelnest/presskit.html`. The static site lives in `build/` after running the build command.

## Build locally

From the press kit folder:

```powershell
cd "D:\Squad Dunk\DATA\New folder"
npm run build:presskit
```

Open the generated product page locally:

```text
build/squad-dunk/index.html
```

The GitHub Pages workflow also publishes a `/presskit/` copy of the product page:

```text
build/presskit/index.html
```

## Publish with GitHub Pages

This repository deploys through GitHub Actions on pushes to `main`.

The deployment uses the custom domain:

```text
dunkthegame.com
```

Public URLs (GitHub Pages redirects `www.dunkthegame.com` to the apex with a 301):

```text
https://dunkthegame.com/
https://dunkthegame.com/presskit/
https://dunkthegame.com/sitemap.xml
```

The workflow publishes `build/CNAME` (copied from the root `CNAME`, exactly `dunkthegame.com`), plus `pages/sitemap.xml` and `pages/robots.txt` at the site root.

## DNS for `dunkthegame.com` (Namecheap BasicDNS)

In Namecheap -> Domain List -> dunkthegame.com -> Advanced DNS, under Host Records:

```text
Type: A      Host: @    Value: 185.199.108.153
Type: A      Host: @    Value: 185.199.109.153
Type: A      Host: @    Value: 185.199.110.153
Type: A      Host: @    Value: 185.199.111.153
Type: AAAA   Host: @    Value: 2606:50c0:8000::153
Type: AAAA   Host: @    Value: 2606:50c0:8001::153
Type: AAAA   Host: @    Value: 2606:50c0:8002::153
Type: AAAA   Host: @    Value: 2606:50c0:8003::153
Type: CNAME  Host: www  Value: gameskatapult-dot.github.io.
```

Remove the parking / URL Redirect records for `@` and `www`. Leave Mail Settings (Email Forwarding) and the SPF `TXT` record as they are.

In GitHub: Settings -> Pages -> Custom domain `dunkthegame.com`, wait for the DNS check, then enable Enforce HTTPS.

## `squaddunk.com` -> `dunkthegame.com` (Cloudflare)

`squaddunk.com` uses Cloudflare nameservers, so its redirect lives there, not on GitHub Pages (a Pages site serves only one custom domain).

1. DNS: switch the `@` `A` records and the `www` `CNAME` to Proxied (orange cloud). Do not touch `MX` or `TXT` records (Google Workspace mail and site verification).
2. Rules -> Redirect Rules -> Create rule:
   - When: Hostname is in `squaddunk.com`, `www.squaddunk.com`
   - Then: Dynamic, expression `concat("https://dunkthegame.com", http.request.uri.path)`, status 301, Preserve query string on.

Result: `http(s)://(www.)squaddunk.com/any/path?x=1` -> `301 https://dunkthegame.com/any/path?x=1`.

## Notes

- The generated HTML uses relative asset paths, so it can be hosted as a static website.
- Do not commit private press links, credentials, or unannounced trailer URLs.
- Re-run the build after changing YAML, XML, images, partials, JavaScript, or CSS.
- Keep the root `CNAME` file and the workflow copy step in sync with the GitHub Pages custom domain setting.
