#!/usr/bin/env python3
"""
segment_regions.py — bake per-region IDs into each component sketch's BLUE channel.

The sketch PNGs are channel-packed (alpha=silhouette, green=shading, RED=ink seams,
blue=unused). The red seam lines partition the silhouette into enclosed cells (= the
visible garment sub-regions / "panels" on the 2D doll). We recover those cells with
flood-fill segmentation and write each cell's small integer ID into the unused BLUE
channel, so the runtime doll can (a) fill each region with its own fabric colour and
(b) hit-test clicks to a region — with ZERO extra assets.

Idempotent: region IDs are derived from R (seams) + A (silhouette), never from blue, so
re-running recomputes the same labels and overwrites blue. Safe to run every build.

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

SEAM_T = 60        # red > this = ink seam line
SIL_T = 40         # alpha > this = inside silhouette
MIN_FRAC = 0.008   # drop regions smaller than this fraction of the silhouette
DILATE = 2         # thicken seams to guarantee region closure


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
        # no internal seams — one whole-silhouette region
        a[..., 2] = np.where(sil, 1, 0).astype(np.uint8)
        Image.fromarray(a, "RGBA").save(path, "PNG", optimize=True)
        return 1
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    total = sil.sum()
    keep = [i + 1 for i, s in enumerate(sizes) if s >= MIN_FRAC * total]
    # stable ordering: top-to-bottom, then left-to-right by centroid
    cents = ndimage.center_of_mass(np.ones_like(lab), lab, keep)
    order = sorted(range(len(keep)), key=lambda k: (round(cents[k][0] / 24), round(cents[k][1] / 24)))
    relabel = np.zeros(n + 1, dtype=int)
    for new_id, k in enumerate(order, start=1):
        relabel[keep[k]] = new_id
    lab2 = relabel[lab]
    # grow region labels to fill the WHOLE silhouette (seam + edge pixels get the nearest
    # region), so every fill pixel and click maps to a region.
    holes = sil & (lab2 == 0)
    if holes.any() and (lab2 > 0).any():
        _, (iy, ix) = ndimage.distance_transform_edt(lab2 == 0, return_indices=True)
        filled = lab2[iy, ix]
        lab2 = np.where(sil, filled, 0)
    a[..., 2] = np.clip(lab2, 0, 255).astype(np.uint8)  # region id -> blue
    Image.fromarray(a, "RGBA").save(path, "PNG", optimize=True)
    return int(lab2.max())


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
