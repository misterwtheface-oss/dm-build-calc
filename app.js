/*
  Dressmaker Build Calculator — app logic (P0, build-first + overlay-driven).
  Reads window.DM_DATA (generated into data.js by build-data.mjs).

  House-style conventions carried from the skeleton (see the build-calc-planner
  references): build-first home; clicking a slot opens a statically-sized SELECTOR
  overlay (#overlay-root); a DETAIL overlay (#detail-overlay-root) stacks above;
  every re-render PRESERVES scrollTop; Escape/✕/backdrop dismiss without commit;
  one delegated click handler per root. Traits are DATA coloured via
  --aff-color/--aff-text; the stat table is a fixed-column grid; a tags×elements
  cross-reference matrix surfaces synergy.

  Dressmaker adaptations (called out where they deviate):
    - "Traits" are the 22 style ItemTags; elements carry WEIGHTED contributions
      (signed ints), not a boolean list. So the xref matrix shows the contribution
      NUMBER per cell (the synergy IS the number) rather than a ● glyph, and the
      trait banners split into positive (association) / negative (conflict) by the
      sign of the weight — the two-channel separation, derived from one data field.
    - Slots are heterogeneous (bodice/skirt/sleeve/collar), each with a component
      AND a fabric; plus a free accessory list, quality sliders, and a quest checker.
*/
(function () {
  "use strict";

  const DATA = window.DM_DATA || {};
  const STORAGE_KEY = "dmbc.build";
  const SLOTS = DATA.slots || ["bodice", "skirt", "sleeve", "collar"];
  const DOLL_ORDER = ["skirt", "bodice", "sleeve", "collar"]; // front-most last (assumed; see Progress.md)
  const SLOT_CONTRIB = DATA.slotContribution || { bodice: 0.35, skirt: 0.40, sleeve: 0.15, collar: 0.10 };
  const DIMINISH = 0.85;

  // ── indexes ──
  const compById = new Map((DATA.components || []).map((c) => [c.id, c]));
  const fabById = new Map((DATA.fabrics || []).map((f) => [f.id, f]));
  const accById = new Map((DATA.accessories || []).map((a) => [a.id, a]));
  const questById = new Map((DATA.quests || []).map((q) => [q.id, q]));
  const tagById = new Map((DATA.tags || []).map((t) => [t.id, t]));
  const compsByKind = (kind) => (DATA.components || []).filter((c) => c.kind === kind);

  // ── state ──
  const state = { build: load(), ovl: null };

  function freshBuild() {
    return {
      components: { bodice: null, skirt: null, sleeve: null, collar: null },
      fabrics: { bodice: null, skirt: null, sleeve: null, collar: null },
      accessories: [],            // array of accessory ids (repeats allowed — count matters)
      quality: { grain: 100, fit: 100, seam: 100 },
      quest: null,
    };
  }
  function load() {
    try {
      const b = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (b && b.components) return Object.assign(freshBuild(), b, {
        components: Object.assign({ bodice: null, skirt: null, sleeve: null, collar: null }, b.components),
        fabrics: Object.assign({ bodice: null, skirt: null, sleeve: null, collar: null }, b.fabrics),
        quality: Object.assign({ grain: 100, fit: 100, seam: 100 }, b.quality),
        accessories: Array.isArray(b.accessories) ? b.accessories : [],
      });
    } catch { /* ignore */ }
    return freshBuild();
  }
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.build)); }

  // ── html helpers ──
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
  const round1 = (n) => Math.round(n * 10) / 10;
  function textColorFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return "#fff";
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#2c2420" : "#fff";
  }
  const tagName = (id) => (tagById.get(id) || {}).name || id;
  const imgTag = (src, cls) => src ? `<img class="${cls || ""}" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">` : "";

  // ── trait banner (a single tag with its signed weight) ──
  function tagBanner(tagId, weight) {
    const t = tagById.get(tagId);
    if (!t) return "";
    const sign = weight > 0 ? "+" : "";
    return `<div class="trait-banner" data-action="nav-tag" data-tag="${esc(tagId)}"
        style="--aff-color:${esc(t.color)};--aff-text:${textColorFor(t.color)}" title="${esc(t.name)}">
      <span class="trait-banner-label">${esc(t.name)}${weight != null ? ` <b>${sign}${weight}</b>` : ""}</span>
    </div>`;
  }
  // Two channels from ONE weighted field: positive weights = associations (this piece
  // pushes that style), negative = conflicts (it fights that style). Never merged.
  function tagBannersHTML(tags) {
    const entries = Object.entries(tags || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const pos = entries.filter(([, w]) => w > 0);
    const neg = entries.filter(([, w]) => w < 0);
    let html = "";
    if (pos.length) html += `<div class="primary-traits">${pos.map(([id, w]) => tagBanner(id, w)).join("")}</div>`;
    if (neg.length) html += `<div class="primary-traits conflict-traits">${neg.map(([id, w]) => tagBanner(id, w)).join("")}</div>`;
    if (!html) html = `<p class="muted">No style contribution.</p>`;
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  //  SCORING ENGINE  (_dm_extract/code/PROCEDURAL_MAP.md §5)
  // ═══════════════════════════════════════════════════════════════
  function presentSlots(b) { return SLOTS.filter((s) => b.components[s]); }

  // Returns per-source tag sums, per-element rows (for the matrix), and final scores.
  function score(b) {
    const comp = {}, fab = {}, acc = {}, rows = [];
    const add = (bucket, tag, v) => { bucket[tag] = (bucket[tag] || 0) + v; };

    // 1. components (flat additiveTags)
    for (const s of SLOTS) {
      const c = b.components[s] && compById.get(b.components[s]);
      if (!c) continue;
      const row = {};
      for (const [t, w] of Object.entries(c.tags)) { add(comp, t, w); row[t] = (row[t] || 0) + w; }
      rows.push({ label: `${cap(s)}: ${c.name}`, kind: "component", slot: s, tags: row });
    }

    // 3. fabrics (area-weighted by slot, renormalized for empty slots)
    const present = presentSlots(b);
    const num = present.reduce((n, s) => n + (SLOT_CONTRIB[s] || 0), 0) || 1;
    for (const s of present) {
      const f = b.fabrics[s] && fabById.get(b.fabrics[s]);
      if (!f) continue;
      const factor = (SLOT_CONTRIB[s] || 0) / num;
      const row = {};
      for (const [t, w] of Object.entries(f.tags)) { const v = w * factor; add(fab, t, v); row[t] = (row[t] || 0) + v; }
      rows.push({ label: `${cap(s)} fabric: ${f.name}`, kind: "fabric", slot: s, tags: row });
    }

    // 4. accessories (0.85ⁿ diminishing per tag) + 2. Elaborate special (+1 each)
    const perTag = {};
    for (const id of b.accessories) {
      const a = accById.get(id); if (!a) continue;
      for (const [t, w] of Object.entries(a.tags)) (perTag[t] = perTag[t] || []).push(w);
    }
    const accRow = {};
    for (const [t, arr] of Object.entries(perTag)) {
      arr.sort((x, y) => Math.abs(y) - Math.abs(x));
      let factor = 1, sum = 0;
      for (const v of arr) { sum += v * factor; factor *= DIMINISH; }
      add(acc, t, sum); accRow[t] = sum;
    }
    if (b.accessories.length) { add(acc, "Elaborate", b.accessories.length); accRow.Elaborate = (accRow.Elaborate || 0) + b.accessories.length; }
    if (b.accessories.length) rows.push({ label: `Accessories ×${b.accessories.length}`, kind: "accessory", tags: accRow });

    // finalize: ceil the summed contribution; drop ≤0
    const final = {};
    for (const t of tagById.keys()) {
      const total = (comp[t] || 0) + (fab[t] || 0) + (acc[t] || 0);
      if (total > 0) final[t] = Math.ceil(total);
    }
    return { comp, fab, acc, rows, final };
  }

  function quality(b) {
    const { grain, fit, seam } = b.quality;
    return Math.round(0.3 * grain + 0.2 * fit + 0.5 * seam);
  }

  // composition + inventory context for quest evaluation
  function context(b) {
    const present = presentSlots(b);
    let totalArea = 0;
    const byFabricType = {}, byColor = {}, fabricsUsed = new Set(), colorsUsed = new Set();
    for (const s of present) {
      const f = b.fabrics[s] && fabById.get(b.fabrics[s]);
      const c = compById.get(b.components[s]);
      if (!f || !c) continue;
      const area = c.fabricArea || 0;
      totalArea += area;
      byFabricType[f.fabricType] = (byFabricType[f.fabricType] || 0) + area;
      fabricsUsed.add(f.id);
      const cols = f.colors.length ? f.colors : ["(none)"];
      for (const col of cols) { byColor[col] = (byColor[col] || 0) + area / cols.length; colsAdd(colorsUsed, col); }
    }
    // accessory tallies
    const accCountByType = {}; const accDistinct = new Set();
    for (const id of b.accessories) {
      const a = accById.get(id); if (!a) continue;
      accDistinct.add(id);
      accCountByType[a.accessoryType] = (accCountByType[a.accessoryType] || 0) + 1;
      if (a.beadAccessoryType) accCountByType[a.beadAccessoryType] = (accCountByType[a.beadAccessoryType] || 0) + 1;
    }
    return { totalArea, byFabricType, byColor, fabricsUsed, colorsUsed, accCountByType, accDistinct };
  }
  function colsAdd(set, c) { if (c !== "(none)") set.add(c); }

  function compare(val, target, cmp) {
    if (cmp === "AtMost") return val <= target;
    if (cmp === "Exactly") return val === target;
    return val >= target; // AtLeast (default)
  }
  const cmpSym = (c) => (c === "AtMost" ? "≤" : c === "Exactly" ? "=" : "≥");

  // Evaluate one requirement → {ok, note, label} (ok may be null = "not a garment check")
  function evalReq(r, b, sc, q, ctx) {
    switch (r.type) {
      case "TagScoreRequirement": {
        const have = sc.final[r.tag] || 0, target = Number(r.targetScore);
        return { ok: compare(have, target, r.comparison), label: `${tagName(r.tag)} style ${cmpSym(r.comparison)} ${target}`, note: `have ${have}` };
      }
      case "QualityRequirement": {
        const target = Number(r.threshold);
        return { ok: compare(q, target, r.comparison), label: `Quality ${cmpSym(r.comparison)} ${target}`, note: `have ${q}` };
      }
      case "FabricCompositionRequirement": {
        const pct = ctx.totalArea ? (ctx.byFabricType[r.fabricType] || 0) / ctx.totalArea * 100 : 0;
        return { ok: pct >= Number(r.minimumPercentage), label: `${esc(r.fabricType)} fabric ≥ ${r.minimumPercentage}%`, note: `have ${pct.toFixed(0)}%` };
      }
      case "ColorCompositionRequirement": {
        const pct = ctx.totalArea ? (ctx.byColor[r.colorType] || 0) / ctx.totalArea * 100 : 0;
        return { ok: pct >= Number(r.minimumPercentage), label: `${esc(r.colorType)} colour ≥ ${r.minimumPercentage}%`, note: `have ${pct.toFixed(0)}%` };
      }
      case "AccessoryCountRequirement": {
        const have = ctx.accCountByType[r.requiredType] || 0;
        return { ok: have >= Number(r.minimumCount), label: `${esc(r.requiredType)} accessories ≥ ${r.minimumCount}`, note: `have ${have}` };
      }
      case "AccessoryVarietyRequirement":
        return { ok: ctx.accDistinct.size >= Number(r.minimumDistinctAccessories), label: `≥ ${r.minimumDistinctAccessories} distinct accessories`, note: `have ${ctx.accDistinct.size}` };
      case "ColorVarietyRequirement":
        return { ok: ctx.colorsUsed.size >= Number(r.minimumDistinctColors), label: `≥ ${r.minimumDistinctColors} distinct colours`, note: `have ${ctx.colorsUsed.size}`, gated: r.gated };
      case "FabricVarietyRequirement":
        return { ok: ctx.fabricsUsed.size >= Number(r.minimumDistinctFabrics), label: `≥ ${r.minimumDistinctFabrics} distinct fabrics`, note: `have ${ctx.fabricsUsed.size}` };
      case "TrimLengthRequirement":
        return { ok: null, label: `${esc(r.requiredType)} trim ≥ ${r.minimumLengthCm}cm`, note: "player-drawn — assumed met" };
      case "SpecificGarmentRequirement": {
        const have = SLOTS.some((s) => { const c = compById.get(b.components[s]); return c && c.name === r.requiredGarment; });
        return { ok: have, label: `Use “${esc(r.requiredGarment)}”`, note: have ? "equipped" : "not equipped" };
      }
      case "ColorTypeRequirement":
      case "FabricTypeRequirement":
        return { ok: null, label: r.type === "ColorTypeRequirement" ? "Allowed-colours constraint" : "Allowed-fabrics constraint", note: "list not in extract — treated as pass" };
      case "QuestOutcomeRequirement":
        return { ok: null, label: "Story availability gate", note: "not a garment check" };
      default:
        return { ok: null, label: r.type, note: "unhandled" };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUILD VIEW (build-first home)
  // ═══════════════════════════════════════════════════════════════
  function paperDollHTML(b) {
    const layers = DOLL_ORDER.map((s) => {
      const c = b.components[s] && compById.get(b.components[s]);
      const sk = c && c.sketches && c.sketches[0];
      return sk ? `<img class="doll-layer" src="${esc(sk)}" alt="" onerror="this.style.visibility='hidden'">` : "";
    }).join("");
    const empty = !presentSlots(b).length;
    return `<div class="doll">${layers}${empty ? `<div class="doll-empty">Pick garment parts to preview the dress</div>` : ""}</div>`;
  }

  function slotRowHTML(b, s) {
    const c = b.components[s] && compById.get(b.components[s]);
    const f = b.fabrics[s] && fabById.get(b.fabrics[s]);
    const fabTile = c
      ? `<div class="tile fab-tile ${f ? "filled" : ""}" data-action="open-fabric" data-slot="${s}" title="${f ? esc(f.name) : "Choose fabric"}">
           ${f ? (f.swatch ? imgTag(f.swatch) : `<span class="swatch-chip" style="background:${esc(f.swatchColor || "#ccc")}"></span>`) : `<span class="tile-empty">fabric</span>`}
         </div>`
      : `<div class="tile fab-tile disabled" title="Choose a ${s} first"><span class="tile-empty">fabric</span></div>`;
    return `<div class="slot-row">
      <div class="slot-label">${cap(s)}</div>
      <div class="tile comp-tile ${c ? "filled" : ""}" data-action="open-slot" data-slot="${s}" title="${c ? esc(c.name) : "Choose " + s}">
        ${c ? (c.icon ? imgTag(c.icon) : (c.sketches[0] ? imgTag(c.sketches[0]) : `<span class="tile-empty">+ ${s}</span>`)) : `<span class="tile-empty">+ ${s}</span>`}
      </div>
      ${fabTile}
      <div class="slot-names">
        <div class="slot-comp-name">${c ? esc(c.name) : `<span class="muted">— empty —</span>`}</div>
        <div class="slot-fab-name">${f ? esc(f.name) : (c ? `<span class="muted">no fabric</span>` : "")}</div>
      </div>
      ${c ? `<button class="ghost tiny" data-action="clear-slot" data-slot="${s}">✕</button>` : ""}
    </div>`;
  }

  function accessoriesHTML(b) {
    if (!b.accessories.length) return `<p class="muted">No accessories.</p>`;
    const counts = new Map();
    for (const id of b.accessories) counts.set(id, (counts.get(id) || 0) + 1);
    const chips = [...counts.entries()].map(([id, n]) => {
      const a = accById.get(id); if (!a) return "";
      return `<div class="acc-chip" data-action="nav-acc" data-id="${esc(id)}" title="${esc(a.name)}">
        ${a.icon ? imgTag(a.icon) : ""}<span class="acc-chip-name">${esc(a.name)}</span>${n > 1 ? `<b class="acc-chip-n">×${n}</b>` : ""}
        <button class="acc-chip-x" data-action="acc-dec" data-id="${esc(id)}" title="Remove one">−</button>
      </div>`;
    }).join("");
    return `<div class="acc-chips">${chips}</div>`;
  }

  // Stat table adaptation: 22 style tags × {Components | Fabrics | Accessories | Total}.
  // Total = the game's ceil(sum) score; source columns are the raw contributions
  // (fabrics/accessories are floats — shown to 1dp). No cell shows two numbers.
  function tagTableHTML(sc) {
    const tagIds = (DATA.tags || []).map((t) => t.id)
      .filter((t) => sc.final[t] || sc.comp[t] || sc.fab[t] || sc.acc[t]);
    if (!tagIds.length) return `<p class="muted">Fill slots to see style scores.</p>`;
    // sort by final score desc, then name
    tagIds.sort((a, b) => (sc.final[b] || 0) - (sc.final[a] || 0) || tagName(a).localeCompare(tagName(b)));
    const numCell = (v, srcCls) => {
      if (!v) return `<span class="stat-src stat-val">—</span>`;
      const disp = v > 0 ? "+" + round1(v) : round1(v);
      return `<span class="stat-src stat-val ${v > 0 ? "pos" : "neg"} ${srcCls}">${disp}</span>`;
    };
    const rows = tagIds.map((t) => {
      const tag = tagById.get(t);
      const total = sc.final[t] || 0;
      const penalty = tag.lowerBetter;
      return `<div class="stat-row ${penalty ? "penalty" : ""}" data-action="nav-tag" data-tag="${esc(t)}">
        <span class="stat-key"><i class="tag-dot" style="background:${esc(tag.color)}"></i>${esc(tag.name)}${penalty ? ` <span class="pen-flag" title="Penalty axis — quests want this LOW">▼</span>` : ""}</span>
        ${numCell(sc.comp[t] || 0, "src-comp")}
        ${numCell(sc.fab[t] || 0, "src-fab")}
        ${numCell(sc.acc[t] || 0, "src-acc")}
        <span class="stat-total">${total}</span>
      </div>`;
    }).join("");
    return `<div class="stat-grid">
      <div class="stat-header"><span>Style tag</span><span>Parts</span><span>Fabric</span><span>Acc.</span><span>Score</span></div>
      ${rows}
    </div>
    <p class="table-foot muted">Score = ⌈Parts + Fabric + Acc.⌉ (dropped if ≤ 0). ▼ = penalty axis.</p>`;
  }

  // Cross-reference matrix: tags (cols) × elements (rows), weighted-contribution cells.
  function xrefHTML(sc) {
    if (!sc.rows.length) return "";
    const tagIds = (DATA.tags || []).map((t) => t.id).filter((t) => sc.final[t] || sc.rows.some((r) => r.tags[t]));
    if (!tagIds.length) return "";
    tagIds.sort((a, b) => (sc.final[b] || 0) - (sc.final[a] || 0) || tagName(a).localeCompare(tagName(b)));
    const colHead = (t) => { const tag = tagById.get(t); return `<th class="xref-colhead"><div class="xref-col" data-action="nav-tag" data-tag="${esc(t)}"
        style="--aff-color:${esc(tag.color)};--aff-text:${textColorFor(tag.color)}">
        <span class="xref-col-name">${esc(tag.name)}</span></div></th>`; };
    const cell = (v) => { if (!v) return `<td></td>`; const d = round1(v); return `<td class="${v > 0 ? "xref-pos" : "xref-neg"}">${v > 0 ? "+" + d : d}</td>`; };
    const bodyRows = sc.rows.map((r) => `<tr>
      <th class="xref-rowhead"><span>${esc(r.label)}</span></th>
      ${tagIds.map((t) => cell(r.tags[t] || 0)).join("")}</tr>`).join("");
    const scoreRow = `<tr class="xref-shared"><th class="xref-rowhead">Final score</th>
      ${tagIds.map((t) => { const n = sc.final[t] || 0; return `<td class="${n ? "xref-sh" : ""}">${n || ""}</td>`; }).join("")}</tr>`;
    return `<section class="xref-section">
      <h2>Style contribution matrix</h2>
      <div class="xref-wrap"><table class="player-xref">
        <thead><tr><th class="xref-corner"></th>${tagIds.map(colHead).join("")}</tr></thead>
        <tbody>${bodyRows}${scoreRow}</tbody>
      </table></div>
      <div class="xref-legend"><span><b class="xref-pos">+n</b> adds style</span><span><b class="xref-neg">−n</b> subtracts</span><span><b class="xref-sh">n</b> final score</span></div>
    </section>`;
  }

  function costHTML(b) {
    const present = presentSlots(b);
    let fabricCost = 0;
    for (const s of present) {
      const f = b.fabrics[s] && fabById.get(b.fabrics[s]);
      const c = compById.get(b.components[s]);
      if (f && c) fabricCost += (c.fabricArea * 1.1 + c.panelCount * 0.02) * f.cost;
    }
    let accCost = 0;
    for (const id of b.accessories) { const a = accById.get(id); if (a) accCost += a.cost; }
    return { fabricCost: Math.round(fabricCost), accCost: Math.round(accCost), total: Math.round(fabricCost + accCost) };
  }

  function questPanelHTML(b, sc, q) {
    const quest = b.quest && questById.get(b.quest);
    const chip = quest
      ? `<button class="quest-chip" data-action="open-quest">
           <span class="quest-chip-name">${esc(quest.name)}</span>
           <span class="quest-chip-meta">${esc(quest.questGiver)} · ${quest.budget}g${quest.isGift ? " · gift" : ""}</span>
         </button>
         <button class="ghost tiny" data-action="clear-quest">✕</button>`
      : `<button class="quest-chip empty" data-action="open-quest"><span class="quest-chip-name">+ Choose a quest to check against</span></button>`;

    let results = "";
    if (quest) {
      const ctx = context(b);
      const cost = costHTML(b);
      const evals = quest.requirements.map((r) => ({ r, e: evalReq(r, b, sc, q, ctx) }));
      const garment = evals.filter((x) => x.e.ok !== null);
      const allMet = garment.every((x) => x.e.ok);
      let outcome, oCls;
      if (quest.isGift) {
        if (allMet) { outcome = "Excelled"; oCls = "excel"; }
        else if (q > 80) { outcome = "Succeeded"; oCls = "pass"; }
        else { outcome = "Failed"; oCls = "fail"; }
      } else {
        outcome = allMet ? "Succeeded" : "Failed"; oCls = allMet ? "pass" : "fail";
      }
      const reqList = evals.map(({ e }) => {
        const cls = e.ok === true ? "req-pass" : e.ok === false ? "req-fail" : "req-na";
        const mark = e.ok === true ? "✓" : e.ok === false ? "✗" : "•";
        return `<li class="${cls}"><span class="req-mark">${mark}</span><span class="req-label">${e.label}</span><span class="req-note">${esc(e.note)}</span></li>`;
      }).join("");
      const overBudget = cost.total > quest.budget;
      results = `<div class="quest-outcome ${oCls}">${outcome}${quest.isGift ? ` <span class="muted">(gift: all-met → Excelled, else quality>80 → Succeeded)</span>` : ""}</div>
        <ul class="req-list">${reqList}</ul>
        <div class="budget-row ${overBudget ? "over" : ""}">
          <span>Materials cost <b>${cost.total}g</b> <span class="muted">(fabric ${cost.fabricCost} + acc ${cost.accCost})</span></span>
          <span>Reward <b>${quest.budget}g</b></span>
        </div>`;
    }
    return `<div class="quest-head">${chip}</div>${results}`;
  }

  function renderApp() {
    const app = document.getElementById("app");
    const prevMain = app.querySelector(".planning-main");
    const prevScroll = prevMain ? prevMain.scrollTop : 0;

    const b = state.build;
    const sc = score(b);
    const q = quality(b);

    app.innerHTML = `
      <header class="app-header">
        <h1>Dressmaker <span>Build Calculator</span></h1>
        <button class="ghost" data-action="clear">Clear</button>
      </header>
      <main class="planning-main">
        <div class="build-grid">
          <section class="doll-pane">${paperDollHTML(b)}</section>
          <section class="controls-pane">
            <div class="panel">
              <h2>Garment</h2>
              <div class="slot-list">${SLOTS.map((s) => slotRowHTML(b, s)).join("")}</div>
            </div>
            <div class="panel">
              <div class="panel-head"><h2>Accessories</h2><button class="ghost tiny" data-action="open-acc">+ Add</button></div>
              ${accessoriesHTML(b)}
            </div>
            <div class="panel">
              <h2>Quality <b class="q-val">${q}</b></h2>
              ${["grain", "fit", "seam"].map((k) => `
                <label class="slider-row">
                  <span>${cap(k)}${k === "fit" ? " ×0.2" : k === "grain" ? " ×0.3" : " ×0.5"}</span>
                  <input type="range" min="0" max="100" value="${b.quality[k]}" data-quality="${k}">
                  <b>${b.quality[k]}</b>
                </label>`).join("")}
              <p class="table-foot muted">grain/fit/seam are minigame execution — set your expected skill.</p>
            </div>
          </section>
        </div>

        <section class="panel quest-panel">
          <h2>Quest check</h2>
          ${questPanelHTML(b, sc, q)}
        </section>

        <section class="panel">
          <h2>Style scores</h2>
          ${tagTableHTML(sc)}
        </section>

        ${xrefHTML(sc)}
      </main>`;

    const newMain = app.querySelector(".planning-main");
    if (newMain) newMain.scrollTop = prevScroll;
  }

  // ═══════════════════════════════════════════════════════════════
  //  SELECTOR OVERLAY  (#overlay-root)
  // ═══════════════════════════════════════════════════════════════
  // Dataset + config per overlay kind.
  function overlayDataset() {
    const o = state.ovl;
    if (o.kind === "component") return filterComponents(o.slot);
    if (o.kind === "fabric") return DATA.fabrics || [];
    if (o.kind === "accessory") return DATA.accessories || [];
    if (o.kind === "quest") return DATA.quests || [];
    return [];
  }
  function filterComponents(slot) {
    const b = state.build;
    if (slot === "bodice") return compsByKind("bodice");
    const bod = b.components.bodice && compById.get(b.components.bodice);
    if (slot === "skirt") return compsByKind("skirt").filter((s) => !bod || !bod.skirtType || s.skirtType === bod.skirtType);
    if (slot === "collar") { if (bod && bod.collarType === "None") return []; return compsByKind("collar").filter((c) => !bod || !bod.collarType || c.collarType === bod.collarType); }
    if (slot === "sleeve") { if (bod && bod.usesSleeves === false) return []; return compsByKind("sleeve"); }
    return [];
  }
  // filter chips (categories) per kind
  function overlayCategories() {
    const o = state.ovl;
    if (o.kind === "fabric") return [...new Set((DATA.fabrics || []).map((f) => f.fabricType))].sort();
    if (o.kind === "accessory") return [...new Set((DATA.accessories || []).map((a) => a.accessoryType))].sort();
    if (o.kind === "quest") return ["quest", "sidequests", "giftquests", "questdemo"];
    return [];
  }
  const catOf = (kind, it) => kind === "fabric" ? it.fabricType : kind === "accessory" ? it.accessoryType : kind === "quest" ? it.category : null;
  const CAT_LABEL = { quest: "Main", sidequests: "Side", giftquests: "Gift", questdemo: "Demo" };

  function overlayTitle() {
    const o = state.ovl;
    if (o.kind === "component") return `Choose ${o.slot}`;
    if (o.kind === "fabric") return `Choose fabric — ${o.slot}`;
    if (o.kind === "accessory") return `Add accessories`;
    if (o.kind === "quest") return `Choose a quest`;
    return "Choose";
  }

  function openOverlay(kind, slot) {
    let pending;
    if (kind === "component") pending = state.build.components[slot] || null;
    else if (kind === "fabric") pending = state.build.fabrics[slot] || null;
    else if (kind === "accessory") pending = state.build.accessories.slice();
    else if (kind === "quest") pending = state.build.quest || null;
    state.ovl = { kind, slot, pending, search: "", cat: null };

    const cats = overlayCategories();
    const catBar = cats.length ? `<div class="ovl-cats">
        <button class="cat-chip active" data-cat="">All</button>
        ${cats.map((c) => `<button class="cat-chip" data-cat="${esc(c)}">${esc(CAT_LABEL[c] || c)}</button>`).join("")}
      </div>` : "";

    const root = document.getElementById("overlay-root");
    root.innerHTML = `
      <div class="overlay-panel" role="dialog" aria-modal="true">
        <div class="overlay-header">
          <h2>${esc(overlayTitle())}</h2>
          <button class="overlay-close" data-action="cancel" aria-label="Close">&times;</button>
        </div>
        <div class="overlay-body">
          <div class="ovl-info"><div class="ovl-left"></div><div class="ovl-right"></div></div>
          <div class="ovl-center">
            <div class="ovl-center-search">
              <input class="ovl-search" type="search" placeholder="Search…" />
              ${catBar}
            </div>
            <div class="ovl-center-scroll"><div class="ovl-grid"></div></div>
          </div>
        </div>
        <div class="overlay-footer">
          <button class="ghost" data-action="cancel">Cancel</button>
          <button data-action="confirm">${kind === "accessory" ? "Done" : "Confirm"}</button>
        </div>
      </div>`;
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    refreshOverlay();
    const input = root.querySelector(".ovl-search");
    const isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (input && !isTouch) input.focus();
  }

  function cardHTML(kind, it, selected) {
    if (kind === "fabric") {
      const inner = it.swatch ? imgTag(it.swatch) : `<span class="swatch-chip" style="background:${esc(it.swatchColor || "#ccc")}"></span>`;
      return `<div class="ovl-card ${selected ? "selected" : ""}" data-action="pick" data-id="${esc(it.id)}" title="${esc(it.name)}">${inner}</div>`;
    }
    if (kind === "quest") {
      return `<div class="ovl-card quest-card ${selected ? "selected" : ""}" data-action="pick" data-id="${esc(it.id)}" title="${esc(it.name)}">
        <span class="quest-card-name">${esc(it.name)}</span>
        <span class="quest-card-meta">${esc(it.questGiver)} · ${it.budget}g</span>
      </div>`;
    }
    // component / accessory — icon or sketch
    const src = it.icon || (it.sketches && it.sketches[0]) || null;
    return `<div class="ovl-card ${selected ? "selected" : ""}" data-action="pick" data-id="${esc(it.id)}" title="${esc(it.name)}">
      ${src ? imgTag(src) : `<span>${esc((it.name || "?")[0])}</span>`}</div>`;
  }

  const OVL_SCROLLERS = [".ovl-center-scroll", ".ovl-info", ".ovl-left", ".ovl-right-body"];
  function refreshOverlay() {
    const o = state.ovl;
    const panel = document.querySelector("#overlay-root .overlay-panel");
    if (!panel || !o) return;
    const saved = OVL_SCROLLERS.map((sel) => { const el = panel.querySelector(sel); return el ? el.scrollTop : 0; });

    const qtext = o.search.trim().toLowerCase();
    let items = overlayDataset();
    if (qtext) items = items.filter((it) => it.name.toLowerCase().includes(qtext));
    if (o.cat) items = items.filter((it) => catOf(o.kind, it) === o.cat);

    const isSel = (it) => o.kind === "accessory" ? o.pending.includes(it.id) : o.pending === it.id;
    panel.querySelector(".ovl-grid").innerHTML = items.length
      ? items.map((it) => cardHTML(o.kind, it, isSel(it))).join("")
      : `<p class="muted">${o.kind === "component" ? "No compatible pieces for this bodice." : "No matches."}</p>`;

    // info panels depend on the "focused" item
    const focusId = o.kind === "accessory" ? (o.lastPick || o.pending[o.pending.length - 1]) : o.pending;
    const focus = focusId ? datasetById(o.kind, focusId) : null;
    renderOverlayInfo(panel, focus);
    panel.querySelector(".overlay-body").classList.toggle("has-selection", !!focus || (o.kind === "accessory" && o.pending.length));

    OVL_SCROLLERS.forEach((sel, i) => { const el = panel.querySelector(sel); if (el) el.scrollTop = saved[i]; });
  }
  function datasetById(kind, id) {
    if (kind === "component") return compById.get(id);
    if (kind === "fabric") return fabById.get(id);
    if (kind === "accessory") return accById.get(id);
    if (kind === "quest") return questById.get(id);
    return null;
  }

  function renderOverlayInfo(panel, focus) {
    const o = state.ovl;
    const left = panel.querySelector(".ovl-left");
    const right = panel.querySelector(".ovl-right");

    // LEFT — style contribution (tags) or, for accessories, the pending list
    if (o.kind === "accessory") {
      const counts = new Map();
      for (const id of o.pending) counts.set(id, (counts.get(id) || 0) + 1);
      left.innerHTML = `<h3>Added (${o.pending.length})</h3>` + (o.pending.size === 0 || !o.pending.length
        ? `<p class="muted">Click accessories to add. Repeats allowed.</p>`
        : `<div class="pending-acc">${[...counts.entries()].map(([id, n]) => {
            const a = accById.get(id); if (!a) return "";
            return `<div class="pending-row"><span>${esc(a.name)}${n > 1 ? ` ×${n}` : ""}</span>
              <span><button class="ghost tiny" data-action="pend-dec" data-id="${esc(id)}">−</button></span></div>`;
          }).join("")}</div>`);
    } else {
      left.innerHTML = `<h3>Style contribution</h3>` + (focus && focus.tags ? tagBannersHTML(focus.tags) : `<p class="muted">Select to preview.</p>`);
    }

    // RIGHT — identity + details
    if (!focus) {
      right.innerHTML = `<div class="ovl-right-top"><h3>Details</h3></div><div class="ovl-right-body"><p class="muted">Select an item.</p></div>`;
      return;
    }
    let body = "";
    if (o.kind === "component") {
      const compat = [];
      if (focus.kind === "bodice") {
        compat.push(`Collar: ${focus.collarType === "None" ? "none" : focus.collarType}`);
        compat.push(`Skirt: ${focus.skirtType}`);
        compat.push(`Sleeves: ${focus.usesSleeves ? "yes" : "no"}`);
      } else if (focus.collarType) compat.push(`Collar type: ${focus.collarType}`);
      else if (focus.skirtType) compat.push(`Skirt type: ${focus.skirtType}`);
      body = `<div class="kv">${compat.map((c) => `<span>${esc(c)}</span>`).join("")}
        <span>Fabric area: ${round1(focus.fabricArea)} · ${focus.panelCount} panels</span></div>`;
    } else if (o.kind === "fabric") {
      body = `<div class="kv"><span>Type: ${esc(focus.fabricType)}</span><span>Colours: ${esc(focus.colors.join(", ") || "—")}</span><span>Cost: ${focus.cost}g/m</span></div>`;
    } else if (o.kind === "accessory") {
      body = `<div class="kv"><span>Type: ${esc(focus.accessoryType)}</span>${focus.beadAccessoryType ? `<span>Counts as bead: ${esc(focus.beadAccessoryType)}</span>` : ""}<span>Cost: ${focus.cost}g</span></div>`;
    } else if (o.kind === "quest") {
      body = `<div class="kv"><span>Giver: ${esc(focus.questGiver)}</span><span>Reward: ${focus.budget}g</span><span>${focus.isGift ? "Gift (3-tier)" : "Standard (all requirements)"}</span></div>
        <ul class="req-list preview">${focus.requirements.map((r) => `<li class="req-na"><span class="req-mark">•</span><span class="req-label">${esc(reqPreview(r))}</span></li>`).join("")}</ul>`;
    }
    right.innerHTML = `<div class="ovl-right-top"><h3>${esc(focus.name)}</h3></div>
      <div class="ovl-right-body">${body}${o.kind !== "quest" && o.kind !== "accessory" ? "" : ""}
        ${focus.tags ? tagBannersHTML(focus.tags) : ""}</div>`;
  }
  function reqPreview(r) {
    switch (r.type) {
      case "TagScoreRequirement": return `${tagName(r.tag)} ${cmpSym(r.comparison)} ${r.targetScore}`;
      case "QualityRequirement": return `Quality ${cmpSym(r.comparison)} ${r.threshold}`;
      case "FabricCompositionRequirement": return `${r.fabricType} ≥ ${r.minimumPercentage}%`;
      case "ColorCompositionRequirement": return `${r.colorType} colour ≥ ${r.minimumPercentage}%`;
      case "AccessoryCountRequirement": return `${r.requiredType} ≥ ${r.minimumCount}`;
      case "AccessoryVarietyRequirement": return `≥ ${r.minimumDistinctAccessories} distinct accessories`;
      case "ColorVarietyRequirement": return `≥ ${r.minimumDistinctColors} colours`;
      case "FabricVarietyRequirement": return `≥ ${r.minimumDistinctFabrics} fabrics`;
      case "TrimLengthRequirement": return `${r.requiredType} trim ≥ ${r.minimumLengthCm}cm`;
      case "SpecificGarmentRequirement": return `Use “${r.requiredGarment}”`;
      case "QuestOutcomeRequirement": return `Story gate`;
      default: return r.type.replace("Requirement", "");
    }
  }

  function closeOverlay(commit) {
    const o = state.ovl;
    if (!o) return;
    if (commit) {
      if (o.kind === "component") {
        const prev = state.build.components[o.slot];
        state.build.components[o.slot] = o.pending;
        if (prev !== o.pending) state.build.fabrics[o.slot] = null; // fabric belongs to the piece
        if (o.slot === "bodice") pruneIncompatible();
      } else if (o.kind === "fabric") state.build.fabrics[o.slot] = o.pending;
      else if (o.kind === "accessory") state.build.accessories = o.pending;
      else if (o.kind === "quest") state.build.quest = o.pending;
      persist();
    }
    state.ovl = null;
    const root = document.getElementById("overlay-root");
    root.classList.add("hidden"); root.setAttribute("aria-hidden", "true"); root.innerHTML = "";
    renderApp();
  }
  // Changing the bodice can invalidate the chosen collar/skirt/sleeve.
  function pruneIncompatible() {
    for (const s of ["skirt", "collar", "sleeve"]) {
      const id = state.build.components[s];
      if (!id) continue;
      if (!filterComponents(s).some((c) => c.id === id)) { state.build.components[s] = null; state.build.fabrics[s] = null; }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DETAIL OVERLAY  (#detail-overlay-root) — tag detail
  // ═══════════════════════════════════════════════════════════════
  function openTagDetail(id) {
    const t = tagById.get(id);
    if (!t) return;
    const contrib = (list, kindLabel) => {
      const users = list.filter((it) => it.tags && it.tags[id]).sort((a, b) => b.tags[id] - a.tags[id]).slice(0, 12);
      if (!users.length) return "";
      return `<h3>${kindLabel}</h3><ul class="trait-users">${users.map((u) => `<li>${esc(u.name)} <b>${u.tags[id] > 0 ? "+" : ""}${u.tags[id]}</b></li>`).join("")}</ul>`;
    };
    const meta = [t.cat, t.lowerBetter ? "penalty axis (quests want it low)" : null, t.special ? `special: ${t.special}` : null].filter(Boolean).join(" · ");
    renderDetail(esc(t.name), `
      <div class="primary-traits">${tagBanner(id, null)}</div>
      <p class="muted">${esc(meta)}</p>
      ${contrib(DATA.components || [], "Top components")}
      ${contrib(DATA.fabrics || [], "Top fabrics")}
      ${contrib(DATA.accessories || [], "Top accessories")}`);
  }
  function openAccDetail(id) {
    const a = accById.get(id); if (!a) return;
    renderDetail(esc(a.name), `<div class="kv"><span>Type: ${esc(a.accessoryType)}</span>${a.beadAccessoryType ? `<span>Bead: ${esc(a.beadAccessoryType)}</span>` : ""}<span>Cost: ${a.cost}g</span></div>${tagBannersHTML(a.tags)}`);
  }
  function renderDetail(title, bodyHtml) {
    const root = document.getElementById("detail-overlay-root");
    root.innerHTML = `<div class="overlay-panel" role="dialog" aria-modal="true">
        <div class="overlay-header"><h2>${title}</h2><button class="overlay-close" data-action="close-detail" aria-label="Close">&times;</button></div>
        <div class="overlay-body"><div class="ovl-center"><div class="ovl-center-scroll detail-main">${bodyHtml}</div></div></div>
        <div class="overlay-footer"><button data-action="close-detail">Close</button></div>
      </div>`;
    root.classList.remove("hidden"); root.setAttribute("aria-hidden", "false");
  }
  function closeDetail() {
    const root = document.getElementById("detail-overlay-root");
    root.classList.add("hidden"); root.setAttribute("aria-hidden", "true"); root.innerHTML = "";
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENT DELEGATION
  // ═══════════════════════════════════════════════════════════════
  function onAppClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action, slot = el.dataset.slot;
    switch (a) {
      case "open-slot": openOverlay("component", slot); break;
      case "open-fabric": if (state.build.components[slot]) openOverlay("fabric", slot); break;
      case "open-acc": openOverlay("accessory"); break;
      case "open-quest": openOverlay("quest"); break;
      case "clear-slot": state.build.components[slot] = null; state.build.fabrics[slot] = null; if (slot === "bodice") pruneIncompatible(); persist(); renderApp(); break;
      case "clear-quest": state.build.quest = null; persist(); renderApp(); break;
      case "acc-dec": { const i = state.build.accessories.indexOf(el.dataset.id); if (i >= 0) state.build.accessories.splice(i, 1); persist(); renderApp(); break; }
      case "nav-tag": openTagDetail(el.dataset.tag); break;
      case "nav-acc": openAccDetail(el.dataset.id); break;
      case "clear": if (confirm("Clear the whole build?")) { state.build = freshBuild(); persist(); renderApp(); } break;
    }
  }
  function onAppInput(e) {
    const k = e.target.dataset && e.target.dataset.quality;
    if (!k) return;
    state.build.quality[k] = Number(e.target.value);
    persist();
    // update just the numbers live without a full re-render jump
    const b = e.target.parentElement.querySelector("b"); if (b) b.textContent = e.target.value;
    const qv = document.querySelector(".q-val"); if (qv) qv.textContent = quality(state.build);
  }
  function onAppChange(e) {
    if (e.target.dataset && e.target.dataset.quality) renderApp(); // recompute scores/quest on release
  }

  function onOverlayClick(e) {
    const el = e.target.closest("[data-action], [data-cat]");
    if (!el) { if (e.target.id === "overlay-root") closeOverlay(false); return; }
    if (el.dataset.cat !== undefined && el.classList.contains("cat-chip")) {
      state.ovl.cat = el.dataset.cat || null;
      const bar = el.parentElement; bar.querySelectorAll(".cat-chip").forEach((c) => c.classList.toggle("active", c === el));
      refreshOverlay();
      return;
    }
    const o = state.ovl;
    switch (el.dataset.action) {
      case "pick": {
        const id = el.dataset.id;
        if (o.kind === "accessory") { o.pending.push(id); o.lastPick = id; }
        else o.pending = o.pending === id ? null : id;
        refreshOverlay();
        break;
      }
      case "pend-dec": { const i = o.pending.indexOf(el.dataset.id); if (i >= 0) o.pending.splice(i, 1); refreshOverlay(); break; }
      case "nav-tag": openTagDetail(el.dataset.tag); break;
      case "cancel": closeOverlay(false); break;
      case "confirm": closeOverlay(true); break;
    }
  }
  function onOverlayInput(e) {
    if (!e.target.classList.contains("ovl-search")) return;
    state.ovl.search = e.target.value;
    refreshOverlay();
  }
  function onDetailClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) { if (e.target.id === "detail-overlay-root") closeDetail(); return; }
    if (el.dataset.action === "close-detail") closeDetail();
    else if (el.dataset.action === "nav-tag") openTagDetail(el.dataset.tag);
  }
  function onKeydown(e) {
    if (e.key !== "Escape") return;
    if (!document.getElementById("detail-overlay-root").classList.contains("hidden")) return closeDetail();
    if (state.ovl) closeOverlay(false);
  }

  // ── init ──
  const app = document.getElementById("app");
  app.addEventListener("click", onAppClick);
  app.addEventListener("input", onAppInput);
  app.addEventListener("change", onAppChange);
  const ovlRoot = document.getElementById("overlay-root");
  ovlRoot.addEventListener("click", onOverlayClick);
  ovlRoot.addEventListener("input", onOverlayInput);
  document.getElementById("detail-overlay-root").addEventListener("click", onDetailClick);
  document.addEventListener("keydown", onKeydown);
  renderApp();
})();
