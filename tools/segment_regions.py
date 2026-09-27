#!/usr/bin/env python3
"""
segment_regions.py — bake per-region IDs into each component sketch's BLUE channel.

The sketch PNGs are channel-packed (alpha=silhouette, green=shading, RED=ink seams,
blue=unused). The red seam lines partition the silhouette into cells; we recover them
with flood-fill segmentation, MERGE decorative fragments (pleats/gathers) into coherent
regions, and write each region's small integer ID into the unused BLUE channel so the
runtime doll can fill each region with its own fabric colour and hit-test clicks — with
ZERO extra assets.

Segmentation pipeline:
  1. silhouette = alpha>SIL_T ; seams = dilate(red>SEAM_T) ; interior = open(sil & ~seams)
  2. connected components; drop specks (<0.3% of silhouette)
  3. grow labels to fill the whole silhouette (nearest region)
  4. MERGE: repeatedly absorb the smallest region into its best SAME-BAND neighbour (max
     vertical overlap, tie-broken by shared-border length) until region count <= MAX and no
     region is smaller than MIN_FRAC. Same-band merging turns ruffle/tier fragments into
     horizontal tiers while leaving distinct panels intact.

Idempotent: IDs derive from R (seams) + A (silhouette), never blue, so re-running recomputes
the same labels. Safe to run every build.

Usage: python tools/segment_regions.py <assets/icons dir>
Prints a JSON summary on the last line. Needs numpy + scipy + Pillow.
"""
import glob
import json
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SEAM_T = 60         # red > this = ink seam line
SIL_T = 40          # alpha > this = inside silhouette
DILATE = 2          # thicken seams to guarantee region closure
SPECK_FRAC = 0.003  # drop raw components smaller than this before merging
MIN_FRAC = 0.05     # after merge, no region smaller than this fraction of the silhouette
MAX_REGIONS = 8     # cap on tappable regions per part


def _region_props(lab):
    """-> (ids, size, y0, y1) dicts, computed in one pass."""
    counts = np.bincount(lab.ravel())
    slices = ndimage.find_objects(lab)
    ids, size, y0, y1 = [], {}, {}, {}
    for i in range(1, len(counts)):
        if counts[i] == 0 or slices[i - 1] is None:
            continue
        ids.append(i); size[i] = int(counts[i])
        sl = slices[i - 1]; y0[i] = sl[0].start; y1[i] = sl[0].stop - 1
    return ids, size, y0, y1


def _adjacency(lab):
    """id -> {neighbour id: shared border length}."""
    adj = {}

    def pair(a, b):
        m = (a != b) & (a > 0) & (b > 0)
        if not m.any():
            return
        for x, y in zip(a[m].tolist(), b[m].tolist()):
            adj.setdefault(x, {}); adj[x][y] = adj[x].get(y, 0) + 1
            adj.setdefault(y, {}); adj[y][x] = adj[y].get(x, 0) + 1

    pair(lab[:, :-1], lab[:, 1:])
    pair(lab[:-1, :], lab[1:, :])
    return adj


def _yoverlap(y0, y1, a, b):
    lo, hi = max(y0[a], y0[b]), min(y1[a], y1[b])
    return max(0, hi - lo) / max(1, min(y1[a] - y0[a], y1[b] - y0[b]))


def _merge(lab):
    while True:
        ids, size, y0, y1 = _region_props(lab)
        if not ids:
            break
        total = sum(size.values())
        below = [i for i in ids if size[i] < MIN_FRAC * total]
        if len(ids) <= MAX_REGIONS and not below:
            break
        victim = min(below, key=lambda i: size[i]) if below else min(ids, key=lambda i: size[i])
        adj = _adjacency(lab)
        neigh = adj.get(victim, {})
        if not neigh:
            if len(ids) > MAX_REGIONS:
                tgt = max((i for i in ids if i != victim), key=lambda i: size[i])
                lab[lab == victim] = tgt
                continue
            break
        # same horizontal band first (max y-overlap), tie-break by shared border length
        tgt = max(neigh, key=lambda j: (_yoverlap(y0, y1, victim, j), neigh[j]))
        lab[lab == victim] = tgt
    return lab


def segment(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    R, A = a[..., 0].astype(int), a[..., 3].astype(int)
    sil = A > SIL_T
    if sil.sum() == 0:
        return 0
    seams = ndimage.binary_dilation(R > SEAM_T, iterations=DILATE)
    interior = ndimage.binary_opening(sil & ~seams, iterations=1)
    lab, n = ndimage.label(interior)
    if n == 0:
        a[..., 2] = np.where(sil, 1, 0).astype(np.uint8)
        Image.fromarray(a, "RGBA").save(path, "PNG", optimize=True)
        return 1
    sizes = np.bincount(lab.ravel())
    total = sil.sum()
    keep = [i for i in range(1, len(sizes)) if sizes[i] >= SPECK_FRAC * total]
    relabel = np.zeros(n + 1, dtype=int)
    for new_id, k in enumerate(keep, start=1):
        relabel[k] = new_id
    lab = relabel[lab]
    # grow labels to fill the whole silhouette (seam/edge pixels -> nearest region)
    if (lab == 0).any() and (lab > 0).any():
        _, (iy, ix) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
        lab = np.where(sil, lab[iy, ix], 0)
    # merge decorative fragments into coherent regions
    lab = _merge(lab)
    # stable, compact IDs: top-to-bottom then left-to-right
    ids, size, _, _ = _region_props(lab)
    cents = ndimage.center_of_mass(np.ones_like(lab), lab, ids)
    order = sorted(range(len(ids)), key=lambda k: (round(cents[k][0] / 24), round(cents[k][1] / 24)))
    out = np.zeros_like(lab)
    for new_id, k in enumerate(order, start=1):
        out[lab == ids[k]] = new_id
    a[..., 2] = np.clip(out, 0, 255).astype(np.uint8)  # region id -> blue
    Image.fromarray(a, "RGBA").save(path, "PNG", optimize=True)
    return int(out.max())


def main():
    root = sys.argv[1]
    sketches = []
    for cat in ("bodices", "skirts", "sleeves", "collars"):
        sketches += glob.glob(os.path.join(root, cat, "*__var*.png"))
    hist = {}
    failed = 0
    for p in sorted(sketches):
        try:
            k = segment(p)
            hist[k] = hist.get(k, 0) + 1
        except Exception as ex:  # noqa: BLE001
            failed += 1
            print(f"  ! {p}: {ex}", file=sys.stderr)
    print(json.dumps({"sketches": len(sketches), "failed": failed, "region_counts": dict(sorted(hist.items()))}))


if __name__ == "__main__":
    main()
