#!/usr/bin/env python3
"""
fabric_colors.py — compute the TRUE display colour of each fabric = albedo x _Color.

Dressmaker fabrics render as (swatch albedo texture) x (material _Color tint). For many
fabrics the albedo is a near-white cloth and the colour lives entirely in the material
tint (e.g. Black Corduroy's albedo is off-white; its _Color is {0.12,0.13,0.16}). So a
plain swatch average is wrong — we must multiply by the material tint, exactly like the
shader. The paper-doll canvas fills each garment part's silhouette with this colour.

Invoked by build-data.mjs:  python tools/fabric_colors.py <extractDir> <manifest.json>
  manifest = [{ "name": <internal fabric name>, "swatch": <shipped swatch path|null> }]
Prints {name: "#rrggbb"} JSON on the last line. Pillow only.
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
    for f in os.listdir(mat_dir):
        if not f.endswith(".mat.meta"):
            continue
        try:
            m = META_GUID_RE.search(open(os.path.join(mat_dir, f), encoding="utf-8", errors="replace").read())
            if m:
                idx[m.group(1)] = os.path.join(mat_dir, f[:-5])  # strip ".meta"
        except OSError:
            pass
    return idx


def material_tint(mat_path):
    """(_Color preferred, else _BaseColor, else white), as 0..1 floats."""
    try:
        t = open(mat_path, encoding="utf-8", errors="replace").read()
    except OSError:
        return (1.0, 1.0, 1.0)
    m = COLOR_RE.search(t) or BASECOLOR_RE.search(t)
    if not m:
        return (1.0, 1.0, 1.0)
    return tuple(float(x) for x in m.groups())


def albedo_avg(swatch_path):
    """Alpha-weighted mean of the central 70% of the swatch, as 0..1 floats."""
    if not swatch_path or not os.path.exists(swatch_path):
        return (1.0, 1.0, 1.0)
    with Image.open(swatch_path) as im:
        im = im.convert("RGBA")
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
        return (1.0, 1.0, 1.0)
    return (r / wsum / 255.0, g / wsum / 255.0, b / wsum / 255.0)


def main():
    extract, manifest_path = sys.argv[1], sys.argv[2]
    mat_dir = os.path.join(extract, "assets", "UnityProject", "ExportedProject", "Assets", "Material")
    fab_dir = os.path.join(extract, "assets", "UnityProject", "ExportedProject", "Assets", "Resources", "data", "fabrics")
    guid_idx = build_guid_index(mat_dir) if os.path.isdir(mat_dir) else {}
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    out = {}
    for e in manifest:
        name = e["name"]
        tint = (1.0, 1.0, 1.0)
        asset = os.path.join(fab_dir, name + ".asset")
        if os.path.exists(asset):
            mm = MAT_GUID_RE.search(open(asset, encoding="utf-8", errors="replace").read())
            if mm and mm.group(1) in guid_idx:
                tint = material_tint(guid_idx[mm.group(1)])
        alb = albedo_avg(e.get("swatch"))
        rgb = [max(0, min(255, round(alb[i] * tint[i] * 255))) for i in range(3)]
        out[name] = "#{:02x}{:02x}{:02x}".format(*rgb)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
