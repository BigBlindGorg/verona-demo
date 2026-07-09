# Edit Kit

Edit the text and assets of this cloned site without touching the engine.

## How this clone works (read this first)

The live site is a **service-worker replay**: `sw.js` maps every original URL to
an opaque blob in `live-assets/*.bin` (552 files). Those bins are the ONLY
content the live site serves.

> ⚠️ The `images/`, `videos/`, `data/` folders at the repo root are a static
> fallback used only when the service worker is unavailable. Editing them does
> NOT change the live experience.

## Quick start — edit text

1. Edit a file in `edit-kit/content/`:

   | file | what's in it |
   |---|---|
   | `metadata.json` | site title, description |
   | `contact.json`  | contact links (email, socials, newsletter) |
   | `projects.json` | every project: name, description, client, tags |
   | `ui-text.json`  | 3D on-screen text (About page copy, nav labels…) |
   | `ui-styles.json`| advanced: 3D text font/size/color blocks |

2. Repack + ship:

   ```sh
   ./edit-kit/deploy.sh "reword about page"
   ```

   (Or just repack locally: `python3 edit-kit/build.py`)

3. Hard-refresh the site (Cmd+Shift+R).

## Quick start — swap an image or video

```sh
python3 edit-kit/swap-asset.py reel              # search -> find the bin number
python3 edit-kit/swap-asset.py 137 my-video.mp4  # replace it
./edit-kit/deploy.sh "new reel video"
```

`manifest.md` lists all 552 bins with their original URLs — grep it to find
anything. Replacements must match the original content-type (`--force` to
override).

## Also hand-editable

- `index.html` / `live.html` — `<title>`, meta description, favicons.
- `unsupported.html` — the fallback page for browsers without WebGL.

## Do NOT touch

- `live-assets/0.bin` — the minified WebGL app engine.
- `.ktx2` textures, geometry `.bin`s, `.wasm` — format-locked engine internals.
- Never rename or delete `live-assets/*.bin` files; `sw.js` maps them by name.

## Kit files

| script | purpose |
|---|---|
| `build.py` | repack `content/*.json` → the right bins (incl. duplicate captures) |
| `deploy.sh` | build + git push + Netlify production deploy |
| `swap-asset.py` | find / replace binary assets by bin number |
| `manifest.py` | regenerate `manifest.md` |
| `extract.py` | ⚠️ reset `content/` from the bins (overwrites local edits) |

Live: https://verona-demo.netlify.app · Repo: https://github.com/BigBlindGorg/verona-demo