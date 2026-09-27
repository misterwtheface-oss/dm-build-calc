# Dressmaker Build Calculator — Spec Plan

## Purpose
A theorycraft sandbox for **Dressmaker** (Unity garment-crafting sim). A player designs a
dress from interchangeable parts + fabrics + accessories and the app reproduces the game's
**tag-score aggregation, quality blend, and quest pass/fail** faithfully — so they can plan a
commission-winning outfit without grinding the craft loop in-game. It also surfaces the
**style-tag associations** every fabric/component/accessory carries, so a player sees which
pieces reinforce (or fight) the style a quest wants.

## Data model
Fed entirely from the `_dm_extract` golden dataset (`data/model/*.json`). All names are the
`prettyName`; the real roster is `obtainable === true`.

- **Tag (trait)** — one of the **22 style ItemTags** (Casual…Workwear). Fields: `id, name,
  color, cat` (style/occasion/motif), `flags` (`lowerBetter` for Uncomfortable; `special`
  for Elaborate = +1 per accessory). These are the "traits" of the house style — the
  association axis every element links to via weighted contributions.
- **Component** — a garment part in one of 4 **slots** (bodice 67 / skirt 56 / sleeve 34 /
  collar 21, obtainable subset). Fields: `id, name, kind, icon, sketches[], additiveTags{tag→int},
  collarType?, skirtType?, usesSleeves?, fabricArea, panelCount`. Compatibility: a **bodice**
  declares the `collarType` + `skirtType` it accepts and whether it `usesSleeves`; collars
  match on `collarType`, skirts on `skirtType`, sleeves gate on `usesSleeves`.
- **Fabric** — chosen per filled slot. Fields: `id, name, swatch|swatchColor, fabricType,
  colors[], cost, tagWeights{tag→int}`. Contributes tag points **area-weighted by slot**.
- **Accessory** — added freely (0..n). Fields: `id, name, icon, accessoryType,
  beadAccessoryType?, cost, tagWeights{}`. Contributes with **0.85ⁿ diminishing**.
- **Quest** — a target to check the build against. Fields: `id, name, category, budget,
  questGiver, requirements[]` (12 types; comparisons pre-decoded).
- **Character** — `measurements{bust,waist,hips}`, `patternUnlocksByLevel`, portraits. Feeds
  the fit term and quest-giver context.

### The scoring engine (the fidelity target — `_dm_extract/code/PROCEDURAL_MAP.md` §5)
Per tag, accumulate a signed sum then `ceil` (drop if ≤0):
1. **Components (flat):** Σ `additiveTags[tag]` over the 4 chosen components.
2. **Elaborate special:** `+ accessoryCount` to the Elaborate tag.
3. **Fabrics (area-weighted):** each filled slot's fabric adds `weight[tag] ·
   slotContribution/num`, where slotContribution = bodice .35 / skirt .40 / sleeve .15 /
   collar .10 and `num` = Σ contributions of *present* slots (renormalizes for missing
   collar/sleeve).
4. **Accessories (diminishing):** per tag, sort accessory weights by |value| desc, sum with
   factor ×0.85ⁿ (strongest full, next ×0.85, …).
- **Quality** = `round(0.3·grain + 0.2·fit + 0.5·seam)` — the three minigame axes are player
  execution, so the planner exposes them as **sliders** (default 100).
- **Quest eval** = strict AND of garment requirements (gift quests = 3-tier ladder:
  all-met→Excelled, else quality>80→Succeeded, else Failed).

## Architecture
- Stack: vanilla HTML/CSS/JS; data compiled to `window.DM_DATA` in `data.js`.
- Data flow: `_dm_extract/data/model/*.json` → `build-data.mjs` (normalizes tag encodings,
  filters obtainable, resolves + copies assets, runs hygiene guardrails) → `data.js` → `app.js`.
- Persistence: localStorage under `dmbc.*`.
- Deploy: GitHub Pages (`misterwtheface-oss/dm-build-calc`), static.

## Feature plan (prioritized)
### P0 — baseline (this session; runnable + testable)
- [x] Build-first home: 2D **paper doll** (stacked 1024² sketch overlays) + the 4 slots.
- [x] Slot → overlay **component selector** (compatibility-filtered) → per-slot **fabric selector**.
- [x] **Accessories** overlay (add/remove multiple).
- [x] **Quality sliders** (grain/fit/seam) → live quality readout.
- [x] **Tag-score table** — 22 tags × {Components | Fabrics | Accessories | Total}, the
      stat-table house style (no cell shows two numbers; penalty tags flagged).
- [x] **Cross-reference matrix** — tags × build elements, weighted contributions + final row.
- [x] **Quest checker** — pick a quest, per-requirement pass/fail + overall outcome; budget vs cost.
- [x] localStorage persistence; scroll-preserving overlays; mobile full-screen reflow.

### P1 — core value (next sessions)
- [ ] Character picker: fit derived from measurements; filter quests by giver; unlock gating.
- [ ] "What does this quest need" solver hints (which tags are short, suggested fabrics/parts).
- [ ] Per-tag detail pages (top-contributing fabrics/components/accessories for a tag).
- [ ] Per-panel fabric mixing (currently one fabric per slot) for exact composition %.
- [ ] Sketch layer-order visual confirmation against the game (the one non-code-certain bit).

### P2 — nice-to-have
- [ ] Sale-price / reward economy readout (materials + labour × quality × prestige bonus).
- [ ] Prestige/relationship unlock timeline; campaign quest spine browser.
- [ ] Save/load/share builds; collection tracking.

## Open questions
- Sketch composite **layer order** (skirt→bodice→sleeve→collar assumed front-most-last) — the
  shader HLSL was stubbed by AssetRipper; confirm visually in-game.
- `ColorTypeRequirement` / `FabricTypeRequirement` allowed-lists are **not in the extract**
  (empty → pass per code); treated as always-satisfied with a note until captured.
- TrimLength is player-drawn at runtime → taken as user input / assumed met.
