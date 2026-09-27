#!/usr/bin/env python3
"""
process_assets.py — copy + downscale the SHIPPED image subset.

Invoked by build-data.mjs with a manifest path. The manifest is a JSON array of
{src, dst, max} entries: copy src -> dst, downscaling so the longest side <= max
(never upscales). Idempotent: skips an entry whose dst already exists unless
--force is passed. Vanilla Pillow, no other deps.

Why this exists: the raw extract swatches/portraits are full-res textures (fabrics
alone are 178 MB). The UI only ever renders small tiles, so we ship downscaled
copies and keep the calculator repo lean + Pages-friendly.
"""
import json
import os
import sys
from PIL import Image

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if not args:
        print("usage: process_assets.py <manifest.json> [--force]", file=sys.stderr)
        sys.exit(2)
    manifest = json.load(open(args[0], encoding="utf-8"))
    copied = skipped = missing = failed = 0
    missing_list = []
    for e in manifest:
        src, dst, mx = e["src"], e["dst"], int(e.get("max", 0))
        if not os.path.exists(src):
            missing += 1
            missing_list.append(src)
            continue
        if os.path.exists(dst) and not force:
            skipped += 1
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            with Image.open(src) as im:
                im = im.convert("RGBA")
                if mx and (im.width > mx or im.height > mx):
                    im.thumbnail((mx, mx), Image.LANCZOS)
                im.save(dst, "PNG", optimize=True)
            copied += 1
        except Exception as ex:  # noqa: BLE001
            failed += 1
            print(f"  ! failed {src}: {ex}", file=sys.stderr)
    # Report as JSON on the last line so the caller can parse it deterministically.
    print(json.dumps({
        "copied": copied, "skipped": skipped, "missing": missing,
        "failed": failed, "missing_list": missing_list[:50],
    }))

if __name__ == "__main__":
    main()
