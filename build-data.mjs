/*
  build-data.mjs — compiles the Dressmaker golden dataset (_dm_extract) into
  data.js (`window.DM_DATA`), copying + downscaling only the shipped image subset
  and running data-hygiene guardrails first.

  Pipeline:
    ../_dm_extract/data/model/*.json  ─┐
    ../_dm_extract/data/model/asset_map.json ─┤ read + transform + normalize tags
    ../_dm_extract/assets/icons/**    ─┘        │
                                                ▼
        tools/process_assets.py (Pillow resize) → assets/icons/**
                                                ▼
        guardrails (tag resolution, dup ids, asset existence) → data.js

  Usage:  node build-data.mjs           (warnings allowed)
          node build-data.mjs --strict  (warnings promoted to errors)
          node build-data.mjs --force   (re-resize assets even if dst exists)

  On any hard error we refuse to write data.js, leaving the last good copy intact.
*/
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// --- config ---
const ACRONYM = "DM";
const EXTRACT = path.resolve("../_dm_extract");
const MODEL = path.join(EXTRACT, "data", "model");
const EXTRACT_ASSETS = path.join(EXTRACT, "assets");
const OUT = "data.js";
const STRICT = process.argv.includes("--strict");
const FORCE = process.argv.includes("--force");
// asset target sizes (longest side, px). Line-art sketches drive the paper doll so
// they stay larger; everything else is a small tile.
const SIZE = { swatch: 160, accIcon: 128, compIcon: 128, sketch: 700, portrait: 320 };
// -------------

const errors = [];
const warnings = [];

if (!fs.existsSync(MODEL)) {
  console.error(`Extract model dir not found: ${MODEL}\nThis build reads the sibling _dm_extract workspace (not shipped).`);
  process.exit(1);
}
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(MODEL, f), "utf8"));

// ── mojibake repair ──────────────────────────────────────────────
// The extract double-encodes some non-ASCII (é stored as the digraph "Ã©"), and
// only in some files. Repair ONLY the known digraphs so already-correct strings
// (fabrics.json already has a proper é) are never corrupted.
const MOJIBAKE = [
  ["Ã©", "é"], ["Ã¨", "è"], ["Ã¡", "á"],
  ["Ã³", "ó"], ["Ã­", "í"], ["Ã¼", "ü"],
  ["Ã±", "ñ"], ["Ã ", "à"], ["Ã§", "ç"],
  ["Ã¤", "ä"], ["Ã¶", "ö"],
];
function fixText(s) {
  if (s == null) return s;
  let out = String(s);
  for (const [bad, good] of MOJIBAKE) out = out.split(bad).join(good);
  return out;
}
const fold = (s) => fixText(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

// ── canonical 22 style tags (the "traits") ───────────────────────
// id = ascii slug (safe in data-attributes/keys); name = display; cat groups them;
// flags encode the two code special-cases. Colours are the single source of truth
// for theming (soft-atelier palette, distinct per tag).
const TAGS = [
  { id: "Casual",        name: "Casual",        cat: "style",    color: "#8FB4A0" },
  { id: "Cool",          name: "Cool",          cat: "style",    color: "#6FA8C7" },
  { id: "Cute",          name: "Cute",          cat: "style",    color: "#E8A0C0" },
  { id: "Daywear",       name: "Daywear",       cat: "occasion", color: "#F0C674" },
  { id: "Eclectic",      name: "Eclectic",      cat: "style",    color: "#A98BC9" },
  { id: "Elaborate",     name: "Elaborate",     cat: "style",    color: "#C9A24B", special: "+1 per accessory" },
  { id: "Elegant",       name: "Elegant",       cat: "style",    color: "#9C7BB0" },
  { id: "Eveningwear",   name: "Eveningwear",   cat: "occasion", color: "#4A5578" },
  { id: "Flowers",       name: "Flowers",       cat: "motif",    color: "#E58FA0" },
  { id: "Formal",        name: "Formal",        cat: "occasion", color: "#6B7A99" },
  { id: "Glamour",       name: "Glamour",       cat: "style",    color: "#D4A85F" },
  { id: "Gothic",        name: "Gothic",        cat: "style",    color: "#5A4A5E" },
  { id: "Patterned",     name: "Patterned",     cat: "style",    color: "#C98B6B" },
  { id: "Playful",       name: "Playful",       cat: "style",    color: "#F2A65A" },
  { id: "Professional",  name: "Professional",  cat: "occasion", color: "#7A8CA3" },
  { id: "Risque",        name: "Risqué",   cat: "style",    color: "#C05A6E" },
  { id: "Romantic",      name: "Romantic",      cat: "style",    color: "#E0879B" },
  { id: "Shimmering",    name: "Shimmering",    cat: "style",    color: "#C7B36B" },
  { id: "Simple",        name: "Simple",        cat: "style",    color: "#A9B0A0" },
  { id: "Uncomfortable", name: "Uncomfortable", cat: "style",    color: "#A65D4E", lowerBetter: true },
  { id: "Warm",          name: "Warm",          cat: "style",    color: "#E08A5B" },
  { id: "Workwear",      name: "Workwear",      cat: "occasion", color: "#8A7256" },
];
// fold(anything) -> canonical tag id, incl. legacy internal aliases (Goth, Risque…)
const TAG_LOOKUP = new Map();
for (const t of TAGS) { TAG_LOOKUP.set(fold(t.id), t.id); TAG_LOOKUP.set(fold(t.name), t.id); }
TAG_LOOKUP.set(fold("Goth"), "Gothic");   // labels.json internal name
TAG_LOOKUP.set(fold("Risque"), "Risque");

function normTags(raw, ownerLabel) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const id = TAG_LOOKUP.get(fold(k));
    if (!id) { errors.push(`${ownerLabel}: unresolved style tag "${k}" (does not map to any of the 22 ItemTags)`); continue; }
    const n = Number(v);
    if (!Number.isFinite(n)) { warnings.push(`${ownerLabel}: non-numeric weight for "${k}"`); continue; }
    out[id] = (out[id] || 0) + n;   // merge if two spellings collapsed to one id
  }
  return out;
}

// ── asset_map + ship list ────────────────────────────────────────
const assetMap = readJSON("asset_map.json");
const ship = [];                 // {src, dst, max}
const shipSeen = new Set();
// Register a source asset (path relative to the extract's assets/) to be copied +
// resized, returning the runtime path the SPA will use (or null if source missing).
function shipAsset(relPath, max) {
  if (!relPath) return null;
  const rel = relPath.replace(/\\/g, "/");
  const src = path.join(EXTRACT_ASSETS, rel);
  const dst = path.join("assets", rel);
  const runtime = "assets/" + rel;
  if (!fs.existsSync(src)) { warnings.push(`asset missing in extract: ${rel} (image dropped, no 404 shipped)`); return null; }
  if (!shipSeen.has(rel)) { shipSeen.add(rel); ship.push({ src, dst, max }); }
  return runtime;
}
const amLook = (...keys) => { for (const k of keys) if (assetMap[k]) return assetMap[k]; return null; };

// ── transforms ───────────────────────────────────────────────────
const SLOT_CONTRIB = { bodice: 0.35, skirt: 0.40, sleeve: 0.15, collar: 0.10 };

// COMPONENTS (all 174 — every garment part is obtainable via patterns)
const rawComp = readJSON("garment_components.json");
const components = rawComp.map((c) => {
  const label = `component ${c.kind}:${c.name}`;
  const am = amLook(`${c.kind}:${c.name}`, `${c.kind}:${c.prettyName}`);
  const icon = am ? shipAsset(am.icon, SIZE.compIcon) : null;
  const sketches = am && am.sketches ? am.sketches.map((s) => shipAsset(s, SIZE.sketch)).filter(Boolean) : [];
  return {
    id: `${c.kind}:${c.name}`,
    name: fixText(c.prettyName || c.name),
    kind: c.kind,
    icon, sketches,
    tags: normTags(c.additiveTags, label),
    collarType: c.collarType ?? null,
    skirtType: c.skirtType ?? null,
    usesSleeves: c.usesSleeves ?? null,
    fabricArea: c.fabricArea ?? 0,
    panelCount: c.panelCount ?? 0,
  };
});

// FABRICS (obtainable only)
const rawFab = readJSON("fabrics.json");
const fabrics = rawFab.filter((f) => f.obtainable).map((f) => {
  const am = amLook(`Fabric:${f.name}`);
  const swatch = am ? shipAsset(am.swatch, SIZE.swatch) : null;
  const swatchColor = am ? (am.swatchColor || null) : null;
  return {
    id: `fabric:${f.name}`,
    name: fixText(f.prettyName || f.name),
    swatch, swatchColor,
    fabricType: fixText(f.fabricType),
    colors: (f.colors || []).map(fixText),
    cost: Number(f.cost) || 0,
    tags: normTags(f.tagWeights, `fabric ${f.name}`),
  };
});

// ACCESSORIES (obtainable only)
const rawAcc = readJSON("accessories.json");
const accessories = rawAcc.filter((a) => a.obtainable).map((a) => {
  const am = amLook(`Accessory:${a.name}`);
  const icon = am ? shipAsset(am.icon, SIZE.accIcon) : null;
  return {
    id: `acc:${a.name}`,
    name: fixText(a.prettyName || a.name),
    icon,
    accessoryType: fixText(a.accessoryType),
    beadAccessoryType: a.beadAccessoryType ? fixText(a.beadAccessoryType) : null,
    cost: Number(a.cost) || 0,
    tags: normTags(a.tagWeights, `accessory ${a.name}`),
  };
});

// QUESTS (all; normalize the tag on TagScore requirements)
const rawQuest = readJSON("quests.json");
const quests = rawQuest.map((q) => ({
  id: q.name,
  name: fixText(q.prettyName || q.name),
  category: q.category,
  isGift: q.category === "giftquests",
  budget: Number(q.budget) || 0,
  questGiver: fixText(q.questGiver),
  requirements: (q.completionRequirements || []).map((r) => {
    const out = { ...r };
    if (r.tag) {
      const id = TAG_LOOKUP.get(fold(r.tag));
      if (!id) errors.push(`quest ${q.name}: requirement references unknown tag "${r.tag}"`);
      out.tag = id || r.tag;
    }
    return out;
  }),
}));

// CHARACTERS (portraits for quest-giver context / P1 picker)
const rawChar = readJSON("characters.json");
const characters = rawChar.map((c) => {
  const am = amLook(`Character:${c.name}`);
  return {
    id: c.name,
    name: fixText(c.prettyName || c.name),
    measurements: c.measurements || null,
    portrait: am ? shipAsset(am.portrait, SIZE.portrait) : null,
    patternUnlocksByLevel: c.patternUnlocksByLevel || {},
  };
});

// ── run the asset resize/copy step ───────────────────────────────
const manifestPath = path.join("assets", "_manifest.json");
fs.mkdirSync("assets", { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(ship));
console.log(`── Assets ───────────────────────`);
console.log(`Shipping ${ship.length} images (downscaled). Running Pillow…`);
const py = spawnSync("python", ["tools/process_assets.py", manifestPath, ...(FORCE ? ["--force"] : [])], { encoding: "utf8" });
if (py.status !== 0) {
  console.error("process_assets.py failed:\n" + (py.stderr || py.stdout || "(no output)"));
  process.exit(1);
}
let assetReport = {};
try { assetReport = JSON.parse((py.stdout.trim().split("\n").pop()) || "{}"); } catch { assetReport = {}; }
console.log(`  copied ${assetReport.copied || 0}, skipped ${assetReport.skipped || 0}, missing ${assetReport.missing || 0}, failed ${assetReport.failed || 0}`);
if (assetReport.missing) warnings.push(`${assetReport.missing} manifest source(s) missing on disk`);
if (assetReport.failed) errors.push(`${assetReport.failed} asset(s) failed to process`);
fs.rmSync(manifestPath, { force: true });

// ── guardrails ───────────────────────────────────────────────────
// 1. duplicate ids across each collection
function checkDupes(list, label) {
  const seen = new Set();
  for (const it of list) {
    if (seen.has(it.id)) errors.push(`duplicate ${label} id "${it.id}"`);
    seen.add(it.id);
  }
}
checkDupes(components, "component");
checkDupes(fabrics, "fabric");
checkDupes(accessories, "accessory");
checkDupes(quests, "quest");

// 2. every referenced runtime asset must now exist on disk (no shipped 404s)
function assertAssets(list, fields) {
  for (const it of list) {
    for (const f of fields) {
      const v = it[f];
      const arr = Array.isArray(v) ? v : v ? [v] : [];
      for (const p of arr) {
        if (p && !fs.existsSync(p)) errors.push(`${it.id}: asset would 404 -> ${p}`);
      }
    }
  }
}
assertAssets(components, ["icon", "sketches"]);
assertAssets(fabrics, ["swatch"]);
assertAssets(accessories, ["icon"]);
assertAssets(characters, ["portrait"]);

// 3. compatibility enums are sane
const COLLAR_TYPES = new Set(["Round", "VNeck", "None", "Detached"]);
const SKIRT_TYPES = new Set(["NaturalWaist", "EmpireWaist"]);
for (const c of components) {
  if (c.kind === "bodice") {
    if (c.collarType && !COLLAR_TYPES.has(c.collarType)) warnings.push(`bodice ${c.id}: unknown collarType "${c.collarType}"`);
    if (c.skirtType && !SKIRT_TYPES.has(c.skirtType)) warnings.push(`bodice ${c.id}: unknown skirtType "${c.skirtType}"`);
  }
}
// A bodice must have at least one compatible collar/skirt/sleeve or the builder dead-ends.
const collars = components.filter((c) => c.kind === "collar");
const skirts = components.filter((c) => c.kind === "skirt");
const sleeves = components.filter((c) => c.kind === "sleeve");
for (const b of components.filter((c) => c.kind === "bodice")) {
  if (b.skirtType && !skirts.some((s) => s.skirtType === b.skirtType))
    warnings.push(`bodice ${b.id}: no compatible skirt for skirtType "${b.skirtType}"`);
  if (b.collarType && b.collarType !== "None" && !collars.some((c) => c.collarType === b.collarType))
    warnings.push(`bodice ${b.id}: no compatible collar for collarType "${b.collarType}"`);
}

// ── hygiene report ───────────────────────────────────────────────
console.log(`── Data hygiene report ──────────`);
console.log(`✓ ${components.length} components, ${fabrics.length} fabrics, ${accessories.length} accessories, ${quests.length} quests, ${characters.length} characters, ${TAGS.length} tags`);
console.log(`  compat: ${collars.length} collars, ${skirts.length} skirts, ${sleeves.length} sleeves`);
if (errors.length) { console.log(`✗ ${errors.length} error(s):`); errors.forEach((e) => console.log(`    ${e}`)); }
if (warnings.length) { console.log(`⚠ ${warnings.length} warning(s):`); warnings.slice(0, 40).forEach((w) => console.log(`    ${w}`)); if (warnings.length > 40) console.log(`    …and ${warnings.length - 40} more`); }
console.log("─".repeat(34));

const hardErrors = errors.length + (STRICT ? warnings.length : 0);
if (hardErrors) { console.error(`BUILD FAILED: ${hardErrors} error(s). ${OUT} left untouched.`); process.exit(1); }

// ── write output ─────────────────────────────────────────────────
const data = {
  tags: TAGS,
  slots: ["bodice", "skirt", "sleeve", "collar"],
  slotContribution: SLOT_CONTRIB,
  components, fabrics, accessories, quests, characters,
  meta: {
    generated: new Date().toISOString(),
    counts: { components: components.length, fabrics: fabrics.length, accessories: accessories.length, quests: quests.length, characters: characters.length },
    source: "_dm_extract golden dataset",
  },
};
fs.writeFileSync(OUT, `window.${ACRONYM}_DATA = ${JSON.stringify(data)};\n`);
console.log(`Wrote ${OUT} (window.${ACRONYM}_DATA) — ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB.`);
