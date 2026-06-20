# Deploying the Squad Dunk Press Kit to GitHub Pages

This press kit is generated with `pixelnest/presskit.html`. The static site lives in `build/` after running the build command.

## Build locally

From the press kit folder:

```powershell
cd "D:\Squad Dunk\DATA\press kit"
node bin/presskit build --pretty-links --collapse-menu
```

Open the generated product page locally:

```text
build/squad-dunk/index.html
```

## Publish with GitHub Pages

Recommended simple setup:

1. Commit the press kit source and generated `build/` folder.
2. Push to GitHub.
3. In GitHub, go to `Settings` -> `Pages`.
4. Set the source to deploy from the branch/folder that contains `build/`.
5. If GitHub Pages cannot use `build/` directly for your repo setup, copy the generated `build/` contents to the Pages publishing folder required by the repository, such as `/docs`, and publish that folder instead.

## Notes

- The generated HTML uses relative asset paths, so it can be hosted as a static website.
- Do not commit private press links, credentials, or unannounced trailer URLs.
- Re-run the build after changing XML, images, partials, or CSS.
