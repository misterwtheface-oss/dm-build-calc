#!/usr/bin/env python3
"""
fabric_swatches.py — ship each fabric's TRUE-COLOURED, tileable swatch + a solid fallback.

Dressmaker fabrics render as (swatch albedo texture) × (material _Color tint). Many albedos
are near-white cloth whose colour lives entirely in the tint (e.g. Black Corduroy). So for
both the picker swatch AND the paper-doll pattern-fill we must bake the tint into the shipped
swatch — tiling the raw albedo would look washed-out/white.

For each fabric with a swatch:
  1. read the EXTRACT ORIGINAL albedo (so re-runs never double-tint),
  2. multiply RGB by the material _Color, downscale to <=MAX, save to the shipped path,
  3. return a representative solid colour = alpha-weighted mean of the tinted swatch.
Fabrics without a swatch (solid-dyed rows) return no colour (caller uses swatchColor).

Usage: python tools/fabric_swatches.py <extractDir> <manifest.json> <maxSize>
  manifest = [{ "name": <internal fabric name>, "swatchRel": <extract-relative path|null>,
               "dst": <shipped path|null> }]
Prints {name: {"color": "#rrggbb"|null, "hasSwatch": bool}} JSON on the last line. Pillow only.
"""
import json
import os
import re
import sys
from PIL import Image

COLOR_RE = re.compile(r"_Color:\s*\{r:\s*([0-9.]+),\s*g:\s*([0-9.]+),\s*b:\s*([0-9.]+)")
BASECOLOR_RE = re.compile(r"_BaseColor:\s*\{r:\s*([0-9.]+),\s*g:\s*([0-9.]+),\s*b:\s*([0-9.]+)")
MAT_GUID_RE = re.compile(r"material:\s*\{fileID:\s*\d+,\s*guid:\s*([0-9a-f]{32})")
META_GUID_RE = re.compile(r"guid:\s*([0-9a-f]{32})")


def build_guid_index(mat_dir):
    idx = {}
    if not os.path.isdir(mat_dir):
        return idx
    for f in os.listdir(mat_dir):
        if f.endswith(".mat.meta"):
            try:
                m = META_GUID_RE.search(open(os.path.join(mat_dir, f), encoding="utf-8", errors="replace").read())
                if m:
                    idx[m.group(1)] = os.path.join(mat_dir, f[:-5])
            except OSError:
                pass
    return idx


def tint_of(fab_dir, guid_idx, name):
    asset = os.path.join(fab_dir, name + ".asset")
    if not os.path.exists(asset):
        return (1.0, 1.0, 1.0)
    mm = MAT_GUID_RE.search(open(asset, encoding="utf-8", errors="replace").read())
    if not mm or mm.group(1) not in guid_idx:
        return (1.0, 1.0, 1.0)
    t = open(guid_idx[mm.group(1)], encoding="utf-8", errors="replace").read()
    m = COLOR_RE.search(t) or BASECOLOR_RE.search(t)
    return tuple(float(x) for x in m.groups()) if m else (1.0, 1.0, 1.0)


def avg_hex(im):
    w, h = im.size
    dx, dy = int(w * 0.15), int(h * 0.15)
    px = list(im.crop((dx, dy, w - dx, h - dy)).getdata())
    r = g = b = wsum = 0.0
    for pr, pg, pb, pa in px:
        a = pa / 255.0
        if a < 0.4:
            continue
        r += pr * a; g += pg * a; b += pb * a; wsum += a
    if wsum == 0:
        return "#cccccc"
    return "#{:02x}{:02x}{:02x}".format(int(r / wsum), int(g / wsum), int(b / wsum))


def main():
    extract, manifest_path, max_size = sys.argv[1], sys.argv[2], int(sys.argv[3])
    mat_dir = os.path.join(extract, "assets", "UnityProject", "ExportedProject", "Assets", "Material")
    fab_dir = os.path.join(extract, "assets", "UnityProject", "ExportedProject", "Assets", "Resources", "data", "fabrics")
    guid_idx = build_guid_index(mat_dir)
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    out = {}
    for e in manifest:
        name = e["name"]
        swatch_rel = e.get("swatchRel")
        if not swatch_rel or not e.get("dst"):
            out[name] = {"color": None, "hasSwatch": False}
            continue
        src = os.path.join(extract, "assets", swatch_rel.replace("\\", "/"))
        if not os.path.exists(src):
            out[name] = {"color": None, "hasSwatch": False}
            continue
        tr, tg, tb = tint_of(fab_dir, guid_idx, name)
        with Image.open(src) as im:
            im = im.convert("RGBA")
            if im.width > max_size or im.height > max_size:
                im.thumbnail((max_size, max_size), Image.LANCZOS)
            px = im.load()
            for y in range(im.height):
                for x in range(im.width):
                    r, g, b, a = px[x, y]
                    px[x, y] = (int(r * tr), int(g * tg), int(b * tb), a)
            os.makedirs(os.path.dirname(e["dst"]), exist_ok=True)
            im.save(e["dst"], "PNG", optimize=True)
            out[name] = {"color": avg_hex(im), "hasSwatch": True}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
