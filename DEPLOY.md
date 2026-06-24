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

## Publish with GitHub Pages

This repository deploys through GitHub Actions on pushes to `main`.

The deployment uses the default GitHub Pages domain. No custom domain is currently configured.

Expected public URL format:

```text
https://gameskatapult-dot.github.io/squad-dunk-press-kit/squad-dunk/
```

The root of the Pages site redirects to `./squad-dunk/`.

## Notes

- The generated HTML uses relative asset paths, so it can be hosted as a static website.
- Do not commit private press links, credentials, or unannounced trailer URLs.
- Re-run the build after changing YAML, XML, images, partials, JavaScript, or CSS.
- To restore a custom domain later, add a root `CNAME` file and update `.github/workflows/pages.yml` to copy it into `build/CNAME` before uploading the Pages artifact.
