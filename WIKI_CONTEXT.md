# Dressmaker — Wiki / Context Tree

## Game basics
Dressmaker is a **garment-crafting sim** (Unity 6, Mono). The loop: measure a customer →
sketch/pick garment parts → cut fabric → sew seams → assemble on a mannequin → submit against
a quest's requirements → earn gold + prestige + relationship + unlocks. A dress is assembled
from **four slots** (bodice, skirt, sleeve, collar), each cut from a **fabric**, plus any
number of **accessories**. It is judged on **22 style tags** and an execution-driven
**quality** score.

## Key mechanics (for the calculator)
- **Tag scoring is multi-source and order-sensitive for accessories.** Components add flat
  `additiveTags`. Fabrics add `tagWeights` **area-weighted by slot** (bodice .35 / skirt .40 /
  sleeve .15 / collar .10), renormalized when a slot is empty. Accessories add `tagWeights`
  with **0.85ⁿ diminishing returns** (sort a tag's accessory weights by |value|, strongest
  counts full). The **Elaborate** tag additionally gets **+1 per accessory**. Final per-tag
  score = `ceil(sum)`, dropped if ≤ 0 (scores are non-negative ints).
- **Quality = 0.3·grain + 0.2·fit + 0.5·seam** (client path). grain/fit/seam are the three
  minigame skill axes — **player execution, not derivable from data** → the planner exposes
  them as sliders (default 100). Gift-quest fallback uses `0.4·grain + 0.6·seam` (no fit).
- **Compatibility is bodice-driven.** The bodice declares `collarType` (Round/VNeck/None/
  Detached), `skirtType` (NaturalWaist/EmpireWaist), and `usesSleeves`. Collars must match the
  bodice's `collarType`; skirts must match `skirtType`; sleeves are allowed only if
  `usesSleeves`. There are **no `excludedComponents`** in the data (all 0). A "None"/empty
  option is always valid for collar and sleeve.
- **Uncomfortable is a penalty axis** (`lowerBetter`) — quests constrain it with `AtMost`.
  **Negative tag weights are real** (a fabric can subtract from a style); they only clamp at
  the *final* per-tag step, so aggregate signed then ceil.
- **Quests = budget + strict-AND requirements.** 12 requirement types (see below). Gift quests
  (`category:giftquests`) use a 3-tier ladder instead of strict AND. `QuestOutcomeRequirement`
  is a story-availability gate, **not** a garment check — ignore for scoring.
- **Data-encoding gotcha (load-bearing):** the extract's tag keys are **inconsistently
  encoded**. `fabrics.json` uses a proper `é` (Risqué), but `garment_components.json` and
  `accessories.json` double-encode it as `Ã©` (→ `Ã©`). The internal `labels.json`
  also uses `Goth`/`Risque` while the data uses `Gothic`/`Risqué`. **`build-data.mjs`
  normalizes every tag key to the canonical 22 and fails on any that doesn't resolve** — do not
  key scoring off raw strings or the sums silently split across `Risqué` vs `RisquÃ©`.

## Requirement types (12) — how the checker evaluates each
| Type | Fields (extracted) | Check |
|---|---|---|
| TagScoreRequirement | tag, comparison, targetScore, gated? | compare final tag score vs target (≥/=/≤) |
| QualityRequirement | comparison, threshold | compare quality vs threshold |
| FabricCompositionRequirement | fabricType, minimumPercentage | fabric-type area fraction ×100 ≥ min |
| ColorCompositionRequirement | colorType, minimumPercentage | color area fraction ×100 ≥ min (multi-color fabric splits area evenly) |
| ColorTypeRequirement | *(allowed list not in extract)* | empty → **pass** (noted gap) |
| FabricTypeRequirement | *(allowed list not in extract)* | empty → **pass** (noted gap) |
| AccessoryCountRequirement | requiredType, minimumCount | count accessories of type (+ beadAccessoryType) ≥ min |
| AccessoryVarietyRequirement | minimumDistinctAccessories | distinct accessory defs ≥ min |
| ColorVarietyRequirement | minimumDistinctColors, gated? | distinct colors across slot fabrics ≥ min |
| FabricVarietyRequirement | minimumDistinctFabrics | distinct fabrics across slots ≥ min |
| TrimLengthRequirement | requiredType, minimumLengthCm | player-drawn → **user input / assumed met** |
| SpecificGarmentRequirement | requiredGarment | that component equipped in a slot |

## Data sources & datamine access
- **Datamine workspace:** `../_dm_extract/` — **NOT shipped** (gitignored; lives as a sibling).
  Entry doc `../_dm_extract/CONTEXT_MAP.md`, dataset spec `../_dm_extract/DATASET.md`,
  formulas `../_dm_extract/code/PROCEDURAL_MAP.md`.
- **How to (re)generate `data.js` + assets:**
  - `node build-data.mjs` — reads `../_dm_extract/data/model/*.json` + `asset_map.json`,
    normalizes tag encodings, filters `obtainable`, copies **only the referenced obtainable**
    PNGs into `assets/icons/`, resolves every reference, prints a hygiene report, and writes
    `data.js` (`window.DM_DATA`). `--strict` promotes warnings to errors.
  - To regenerate the extract itself (rarely needed): run the Python scripts in
    `../_dm_extract/code/` in the order in `DATASET.md` — the dataset is declared
    self-sufficient, so this should not be necessary for the app.
- **What's shipped vs gitignored:**
  - **SHIPPED:** `data.js`, `assets/icons/**` (only the obtainable subset the SPA renders),
    all app code + planning docs.
  - **GITIGNORED / never committed:** `../_dm_extract/` (raw YAML, decompiled C#, full 294 MB
    icon export, extractor scripts), and any `assets/_full_export/` staging.

## Data model reference
The authoritative shapes live in `../_dm_extract/DATASET.md`. `build-data.mjs` is the single
transform boundary: read it to see exactly which extract fields become which `window.DM_DATA`
fields, and how tag keys are canonicalized.
