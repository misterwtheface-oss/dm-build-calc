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
