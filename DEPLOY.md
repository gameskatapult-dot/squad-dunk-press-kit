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

The deployment uses the default GitHub Pages domain. No custom domain is currently configured.

Expected public URLs:

```text
https://gameskatapult-dot.github.io/squad-dunk-press-kit/presskit/
https://gameskatapult-dot.github.io/squad-dunk-press-kit/squad-dunk/
```

The root of the Pages site redirects to `./presskit/`.

## Using `squaddunk.com/presskit`

GitHub Pages custom domains work at the domain or subdomain level, not as a standalone path on a domain hosted somewhere else. That means this repository cannot directly claim only `squaddunk.com/presskit` while another website controls `squaddunk.com`.

Recommended setup:

1. Keep the main `squaddunk.com` website wherever it is hosted.
2. Copy or deploy the generated `build/presskit/` folder into the main website as `/presskit/`.
3. Keep all files inside that folder together, including `images/`, `css/`, `js/`, `images.zip`, and `logo.zip`.

Alternative setup if the main website host supports rewrites/proxies:

```text
squaddunk.com/presskit/* -> https://gameskatapult-dot.github.io/squad-dunk-press-kit/presskit/*
```

Do not add a `CNAME` file for `squaddunk.com` in this repository unless this press kit repository should control the whole root domain.

## Notes

- The generated HTML uses relative asset paths, so it can be hosted as a static website.
- Do not commit private press links, credentials, or unannounced trailer URLs.
- Re-run the build after changing YAML, XML, images, partials, JavaScript, or CSS.
- To restore a custom domain later, add a root `CNAME` file and update `.github/workflows/pages.yml` to copy it into `build/CNAME` before uploading the Pages artifact.
