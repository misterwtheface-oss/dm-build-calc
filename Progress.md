# Dressmaker Build Calculator — Progress

## Current state
Session 1 (2026-09-27): scaffolded from the `build-calc-planner` skill. Full **P0** built and
running — build-first paper doll, compatibility-filtered component + fabric selectors,
accessories, quality sliders, the faithful **tag-score engine** (component flat + fabric
area-weighted + accessory 0.85ⁿ + Elaborate special), the tag-score stat table, a tags×elements
cross-reference matrix, a per-requirement quest checker, and budget/cost. Fed from `_dm_extract`
via `build-data.mjs` (tag-encoding normalization + obtainable filter + asset copy + hygiene
guardrails). Soft-atelier palette. Deployed to GitHub Pages.

## Backlog
### Next up (P1)
- [ ] Character picker → derive fit from measurements; filter quests by giver; unlock gating.
- [ ] Quest solver hints (which tags are short; suggest fabrics/components to close the gap).
- [ ] Per-tag detail pages (top contributors for a tag across fabrics/components/accessories).
- [ ] Per-panel fabric mixing (currently one fabric per slot) for exact composition %.
- [ ] Confirm sketch composite layer order visually against the game.
### Later (P2)
- [ ] Sale-price / reward economy readout.
- [ ] Prestige/relationship unlock timeline + campaign spine browser.
- [ ] Save/load/share builds; collection tracking.

## Root-cause: missing assets (investigated 2026-09-27)
All 178 missing-asset objects are **cut/unfinished content in the game's own
ScriptableObjects**, not an extraction failure:
- **85 fabrics** = WIP rows (`prestigeUnlockLevel == -1`), **74 accessories** = art-less
  rows — both already filtered out by the `obtainable` flag.
- **19 components** (7 bodice / 9 skirt / 3 sleeve) declare **null art in source**
  (`icon`/`sketchedSprite`/`mannequinMesh` all `{fileID: 0}`), carry `additiveTags` but no
  mesh (`fabricArea 0`), and are wired into **no** progression path (100% correlation:
  every referenced component has art; every image-less one is unreferenced). These had **no
  `obtainable`-style flag**, so they were shipping as blank, unbuildable picker tiles.
  → **Fixed:** `build-data.mjs` now excludes components with no renderable art (155 ship,
  19 excluded, logged in the hygiene report). Result: **0 image-less objects** in `data.js`.
- Note: `_dm_extract/DATASET.md` claims the 19 "have a `sketches[]` visual instead" — that
  is **incorrect** (they have neither icon nor sketch nor mesh). Correct the extract doc if
  revisited.

## Paper-doll rendering — region-mask + PATTERN FILL (reworked 2026-09-27)
**⚠ Supersedes an earlier wrong model.** The handoff `_dm_extract/SKETCH_COLORING.md` (+ the
drop-in reference `_dm_extract/code/sketch_fill.js`) is ground truth: the sketch PNG is a
**REGION MASK**, not a channel-packed shading image. Each region = pixels whose **(R,G) quantize
to the closed palette {0,204,255}²** (≤9 regions/part, B≈0), regions separated by **transparent
gaps**; the pencil outlines are drawn from those gaps, not baked. My earlier flood-fill /
blue-channel / merge segmentation was reconstructing regions the wrong way and is **removed**
(`tools/segment_regions.py` deleted).

Current implementation (ported from `sketch_fill.js` into `app.js`):
- **Regions = quantized (R,G)** via `keyMap` (cached per src). A region's key string `"R,G"` is
  its stable ID. Artist-authored, so L/R sharing a value fill together and differing values fill
  independently — both intentional (matches the user's "L/R split is valid" note; no merge needed).
- **Pattern fill:** each region is filled with its fabric's **tiled swatch texture** (or solid
  colour), clipped to the region mask via `destination-in`; tile density from `tileScale`
  (`reps = 6·√(mean(tileScale)/6)`). `renderPart` → per-part canvas; layers cached by
  `(comp|base|overrides)`; composite skirt→bodice→sleeve→collar.
- **Crisp borders come for free:** masks ship **verbatim** (byte copy, no LANCZOS — resampling
  would blur the flat values + thin gaps), alpha is bimodal, and outlines are the 1px mask
  boundaries. No more fuzzy halo.
- **Per-region assignment:** base fabric fills all regions; **tap a region → pick a fabric for
  just that region** (`build.regionFabrics[componentId]["R,G"]`); uncoloured regions show paper
  tone. Overrides cleared when the component changes/clears.

**Tinted swatches (correctness for pattern fill):** `tools/fabric_swatches.py` bakes
`albedo × material _Color` into each shipped swatch (256px) — raw albedo is near-white for dyed
cloth (Black Corduroy) so tiling it would look washed-out. Also yields a representative solid
`color` (solid-dyed fabrics + fallback). 287 tinted patterns + 65 solid; `tileScale` shipped per
fabric. The fabric picker + slot tiles now show true colours too.

Verified in-app: floral bodice + gingham sleeve + check skirt + solid collar tile correctly with
crisp borders; a per-region override (gingham waistband) renders over the base.

**Per-panel CALC — separate next task (not started).** Sketch regions are NOT fabric panels
(SKETCH_COLORING.md: only 16/153 match; no region↔panel mapping in data). Pattern fill is
**cosmetic**. Scoring still uses per-slot fabric today; per-panel calc uses
`fabricByVariation[].panels[]` (name, 3D `area`, `dims`, `zones` bitmask 1=F/2=B/4=L/8=R) →
cost / composition % / area-weighted tags. Keep the two surfaces separate.

## Known issues / warnings
- **ColorTypeRequirement / FabricTypeRequirement allowed-lists are not in the extract** — they
  carry only `type`, so the checker treats them as always-pass (code says empty=pass). Flagged
  in the quest checker UI. Capture the lists if a quest ever hinges on them.
- **TrimLength** requirements are player-drawn at runtime → the checker assumes met (shown as an
  assumption, not a computed pass).
- **One fabric per slot** (not per-panel) — composition % is exact at slot granularity but the
  game allows per-panel fabric mixing; a mixed build's fractions could differ. P1.
- **Sketch layer order** is the one non-code-certain rendering bit (AssetRipper stubbed the
  composite shader). Assumed skirt→bodice→sleeve→collar (front-most last).
- Fit slider is a stand-in until the character picker derives it from measurements (P1).

## Session log
- 2026-09-27: Scaffolded project (planning docs + skeleton). Adapted the generic skeleton to
  Dressmaker's heterogeneous slots + weighted-tag association model. Implemented the full P0
  scoring engine and quest checker. Built data pipeline off `_dm_extract`, deployed to Pages.
