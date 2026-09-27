# Dressmaker Build Calculator

A single-page build calculator for **Dressmaker** (Unity garment-crafting sim), hosted on
GitHub Pages. Vanilla HTML/CSS/JS — no framework. Design a dress from parts + fabrics +
accessories and see the faithful **tag scores, quality, and quest pass/fail** the game would
compute, plus the style-tag associations every piece carries.

## Develop
```bash
node build-data.mjs          # _dm_extract -> data.js + assets (runs hygiene guardrails)
node build-data.mjs --force  # also re-downscale assets that already exist
node build-data.mjs --strict # promote warnings to errors (pre-release pass)
node tools/serve.mjs         # preview at http://localhost:8080 (+ LAN URL for phone testing)
```
Stop the preview server (Ctrl+C) when done.

## Data pipeline
`../_dm_extract/data/model/*.json` → **`build-data.mjs`** → `data.js` (`window.DM_DATA`) + `assets/icons/**`.
The build:
- **Normalizes the 22 style-tag keys** across all files (the extract double-encodes `é` in
  some files and uses legacy internal names like `Goth`) and **fails on any tag that doesn't
  resolve** — otherwise scoring sums would silently split across spellings.
- Filters to the **obtainable** roster; resolves every asset via `asset_map.json`.
- **Downscales + copies only the shipped image subset** (Pillow, via `tools/process_assets.py`):
  294 MB of full-res textures → ~25 MB of UI tiles.
- Runs guardrails: duplicate ids, would-404 assets, compatibility-enum sanity, dead-end
  bodices — refusing to write `data.js` on any error.

The datamine workspace (`../_dm_extract`) is a **sibling and never committed** — only `data.js`,
the downscaled `assets/icons/**`, and the app code ship. See `WIKI_CONTEXT.md`.

## Scoring model
Encoded from `../_dm_extract/code/PROCEDURAL_MAP.md` §5. Per tag: component flat `additiveTags`
+ fabric `tagWeights` area-weighted by slot (bodice .35 / skirt .40 / sleeve .15 / collar .10,
renormalized) + accessory `tagWeights` with 0.85ⁿ diminishing + Elaborate `+1/accessory`;
`ceil`, dropped if ≤0. Quality = `0.3·grain + 0.2·fit + 0.5·seam` (skill axes are sliders).

## Deploy (GitHub Pages)
1. `git push` to `misterwtheface-oss/dm-build-calc`.
2. Enable Pages on the default branch, `/root`. Static — no build action.
3. (At public release only) uncomment the Cloudflare beacon in `index.html`.

## Project docs
- `SPEC_PLAN.md` — architecture + phased feature plan.
- `WIKI_CONTEXT.md` — game context, scoring rules, and how to regenerate data.
- `Progress.md` — **read first when resuming**: current state + backlog.
