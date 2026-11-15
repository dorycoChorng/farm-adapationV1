"""
Builds src/data/hwsd-cambodia.json: the Harmonized World Soil Database v2.0
(FAO & IIASA, 2023) for Cambodia and its borders, so the app has a second soil
estimate that works offline there.

HWSD v2 maps soil mapping units (SMUs) at 30 arc-seconds (about 1 km). Each SMU
lists up to a dozen soils with their share; this keeps the dominant soil
(SEQUENCE 1) and its topsoil layer (D1, 0-20 cm), copied unchanged.

Inputs (FAO, CC BY 4.0), downloaded into a cache folder given as the first argument:
  https://s3.eu-west-1.amazonaws.com/data.gaezdev.aws.fao.org/HWSD/HWSD2_RASTER.zip
  https://s3.eu-west-1.amazonaws.com/data.gaezdev.aws.fao.org/HWSD/HWSD2_DB.zip
The database is Microsoft Access; it is read with the pure-Python access-parser
(its wheel fails to build on new Python, so add its unpacked sdist to PYTHONPATH):

  python3 -m pip download --no-deps --no-binary :all: access-parser && tar xzf access_parser-*.tar.gz
  python3 -m pip install numpy construct tabulate
  PYTHONPATH=access_parser-0.0.6 python3 scripts/build-hwsd.py /tmp/hwsd-cache
"""
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from access_parser import AccessParser

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://s3.eu-west-1.amazonaws.com/data.gaezdev.aws.fao.org/HWSD/"
# Cambodia (about 102.3-107.7 E, 10.4-14.7 N) with a margin into its neighbours.
WEST, EAST, SOUTH, NORTH = 102.0, 108.0, 10.0, 15.0
CELL = 1 / 120  # 30 arc-seconds
FIELDS = ["PH_WATER", "ORG_CARBON", "CLAY", "SAND", "SILT", "CEC_SOIL", "TEB", "BSAT", "TOTAL_N"]


def fetch(cache, name):
    zpath = cache / name
    if not zpath.exists():
        print("downloading", name)
        urllib.request.urlretrieve(BASE + name, zpath)
    out = cache / name.replace(".zip", "")
    if not out.exists():
        zipfile.ZipFile(zpath).extractall(out)
    return out


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    # HWSD uses negative values (-9, -1) for "no data". Stored as single-precision floats.
    return None if f < 0 else round(f, 2)


def main(cache):
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    raster = fetch(cache, "HWSD2_RASTER.zip")
    db = AccessParser(str(fetch(cache, "HWSD2_DB.zip") / "HWSD2.mdb"))

    hdr = dict(line.split()[:2] for line in (raster / "HWSD2.hdr").read_text().splitlines() if line.strip())
    rows, cols = int(hdr["NROWS"]), int(hdr["NCOLS"])
    left = float(hdr["ULXMAP"]) - CELL / 2
    top = float(hdr["ULYMAP"]) + CELL / 2
    nodata = int(hdr["NODATA"])
    grid = np.memmap(raster / "HWSD2.bil", dtype="<u2", mode="r", shape=(rows, cols))
    c0, c1 = round((WEST - left) / CELL), round((EAST - left) / CELL)
    r0, r1 = round((top - NORTH) / CELL), round((top - SOUTH) / CELL)
    window = np.array(grid[r0:r1, c0:c1])
    ids = sorted(int(v) for v in np.unique(window) if v != nodata)

    layers = db.parse_table("HWSD2_LAYERS")
    texture = dict(zip(*db.parse_table("D_TEXTURE_USDA").values()))
    drainage = {k: v.strip() for k, v in zip(*list(db.parse_table("D_DRAINAGE").values())[1:])}
    wrb = dict(zip(*db.parse_table("D_WRB2").values()))

    wanted = set(ids)
    smus = {}
    for i, smu in enumerate(layers["HWSD2_SMU_ID"]):
        if smu not in wanted or layers["SEQUENCE"][i] != 1 or layers["LAYER"][i] != "D1":
            continue
        smus[str(smu)] = {
            "soil": wrb.get(layers["WRB2"][i], layers["WRB2"][i]),
            "share": num(layers["SHARE"][i]),
            "texture": texture.get(layers["TEXTURE_USDA"][i]),
            "drainage": drainage.get(layers["DRAINAGE"][i]),
            **{f.lower(): num(layers[f][i]) for f in FIELDS},
        }

    # Run-length encode the window row by row: [value, count, value, count, ...].
    flat = window.ravel()
    rle, start = [], 0
    for k in range(1, len(flat) + 1):
        if k == len(flat) or flat[k] != flat[start]:
            v = int(flat[start])
            rle += [0 if v == nodata else v, k - start]
            start = k

    doc = {
        "source": "Harmonized World Soil Database v2.0 (FAO & IIASA, 2023), dominant soil, topsoil 0-20 cm",
        "licence": "CC BY 4.0",
        "west": WEST,
        "north": NORTH,
        "cell": CELL,
        "width": int(window.shape[1]),
        "height": int(window.shape[0]),
        "rle": rle,
        "units": smus,
    }
    out = ROOT / "src/data/hwsd-cambodia.json"
    out.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"{len(smus)} soil units, {len(rle) // 2} runs, {out.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main(sys.argv[1])
