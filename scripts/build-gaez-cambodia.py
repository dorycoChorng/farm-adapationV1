"""
Builds src/data/gaez-cambodia.json: the FAO GAEZ v5 grid cells (5 arc-minutes, about
10 km) covering Cambodia, with the harvested area of all crops and, for Cambodia's ten
main crops, harvested area and yield. With it the app answers "what is grown around
here" in Cambodia instantly and offline, instead of downloading about 2 MB from FAO's
bucket. The values are copied from the same files the app reads online
(src/env/gaez.ts), so both paths give the same numbers.

  python3 -m pip install rasterio numpy
  python3 scripts/build-gaez-cambodia.py /tmp/gaez-cache   (same cache as build-gaez.py)
"""
import json
import sys
from pathlib import Path

import numpy as np
from rasterio import features

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module

gaez = import_module("build-gaez")  # reuse its download and reading helpers

ROOT = Path(__file__).resolve().parent.parent
CELL = 1 / 12
# Cambodia's extent rounded out to whole cells.
WEST, EAST, SOUTH, NORTH = 102.25, 107.75, 10.25, 14.75


def main(cache):
    cache = Path(cache)
    table = json.loads((ROOT / "src/data/gaez-countries.json").read_text())
    codes = [c[0] for c in table["countries"]["KHM"]["crops"][:10]]

    total, transform, shape = gaez.read(cache, "RES06-HAR", "ALL")
    c0 = round((WEST - transform.c) / CELL)
    r0 = round((transform.f - NORTH) / CELL)
    width = round((EAST - WEST) / CELL)
    height = round((NORTH - SOUTH) / CELL)
    win = (slice(r0, r0 + height), slice(c0, c0 + width))

    ne = json.loads(gaez.fetch(gaez.NE50, cache / "ne50.geojson").read_text())
    khm = [f["geometry"] for f in ne["features"] if gaez.iso3(f["properties"]) == "KHM"]
    mask = features.rasterize(((g, 1) for g in khm), out_shape=shape, transform=transform, dtype="uint8", all_touched=True)[win] == 1

    flat = mask.ravel()
    # Cells inside Cambodia as runs of [cells to skip, cells to keep], row by row from the north-west.
    runs, i = [], 0
    while i < flat.size:
        j = i
        while j < flat.size and not flat[j]:
            j += 1
        k = j
        while k < flat.size and flat[k]:
            k += 1
        if k > j:
            runs += [j - i, k - j]
        i = k

    def cells(a, scale):
        return np.rint(a[win] * scale).ravel()[flat].astype(np.int64).tolist()

    out = {
        "source": "FAO GAEZ v5 RES06 HAR (thousand ha) and YLD (t/ha), rain-fed + irrigated (WST), year 2020",
        "west": WEST,
        "north": NORTH,
        "cell": CELL,
        "width": width,
        "height": height,
        "runs": runs,
        # One value per kept cell, in order. Hectares; tonnes per hectare × 100.
        "all": cells(total, 1000),
        "crops": {},
    }
    for code in codes:
        har, _, _ = gaez.read(cache, "RES06-HAR", code)
        yld, _, _ = gaez.read(cache, "RES06-YLD", code)
        out["crops"][code] = {"ha": cells(har, 1000), "yield": cells(yld, 100)}
    dest = ROOT / "src/data/gaez-cambodia.json"
    dest.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(dest, dest.stat().st_size // 1024, "KiB,", int(mask.sum()), "cells")


if __name__ == "__main__":
    main(sys.argv[1])
