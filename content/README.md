# Editing Squad Dunk press kit content

For quick text edits, update:

`content/squad-dunk.yml`

This is the human-friendly source for the Squad Dunk page copy. Do not edit `build/` files directly, because GitHub Pages regenerates them during deploy.

Common edits:

- `description`: short product summary near the top of the page.
- `history`: longer narrative description.
- `features`: bullet list.
- `genres`: factsheet genre tags.
- `platforms`: factsheet platform entries.
- `contacts`: press and studio links.

After editing locally, run:

```bash
npm run content
npm run build:presskit
```

On GitHub, editing `content/squad-dunk.yml` and committing to `main` is enough. The GitHub Pages workflow regenerates `squad-dunk/data.xml` and deploys the site automatically.
