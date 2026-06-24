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
squaddunk.com
```

Expected public URLs after DNS and GitHub Pages certificate provisioning:

```text
https://squaddunk.com/presskit/
https://squaddunk.com/
```

The root of the Pages site redirects to `./presskit/`, so visitors to `https://squaddunk.com/` land on the press kit for now.

The workflow publishes:

```text
build/CNAME
```

with exactly:

```text
squaddunk.com
```

## DNS for `squaddunk.com`

At the DNS provider for `squaddunk.com`, configure the apex/root domain to point to GitHub Pages.

Add these `A` records:

```text
Type: A
Name: @
Value: 185.199.108.153

Type: A
Name: @
Value: 185.199.109.153

Type: A
Name: @
Value: 185.199.110.153

Type: A
Name: @
Value: 185.199.111.153
```

Optional IPv6 records:

```text
Type: AAAA
Name: @
Value: 2606:50c0:8000::153

Type: AAAA
Name: @
Value: 2606:50c0:8001::153

Type: AAAA
Name: @
Value: 2606:50c0:8002::153

Type: AAAA
Name: @
Value: 2606:50c0:8003::153
```

Remove or replace any conflicting `A`, `AAAA`, `ALIAS`, `ANAME`, or `CNAME` records for the root `@` domain before expecting GitHub Pages to validate cleanly.

In GitHub:

1. Go to `Settings` -> `Pages`.
2. Set `Custom domain` to `squaddunk.com`.
3. Wait for the DNS check to pass.
4. Enable `Enforce HTTPS` once the certificate is available.

Do not use `press.squaddunk.com` for this setup.

Note: this means the press kit repository controls the root `squaddunk.com` domain. The main game website can later replace this by moving the press kit into that site's `/presskit/` path or by adding a hosting-level rewrite.

## Notes

- The generated HTML uses relative asset paths, so it can be hosted as a static website.
- Do not commit private press links, credentials, or unannounced trailer URLs.
- Re-run the build after changing YAML, XML, images, partials, JavaScript, or CSS.
- Keep the root `CNAME` file and the workflow copy step in sync with the GitHub Pages custom domain setting.
