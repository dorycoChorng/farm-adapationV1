"""
Builds src/data/gaez-countries.json: harvested area, production and value of the
33 crops and crop groups mapped by FAO GAEZ v5 ("Actual yields and production",
year 2020 from FAOSTAT 2019-2021 averages), summed for every country.

Inputs (downloaded on first run into a cache folder given as the first argument):
  - GAEZ v5 RES06 rasters, 5 arc-minutes, from FAO's public bucket
    https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/MAPSET/
  - Natural Earth 1:50m countries (public domain), for the country of each grid cell
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

Values are FAO's, summed without adjustment. Production values use the international
prices GAEZ v5 lists for each crop group (constant 2014-2016 international dollars per
tonne, GAEZ v5 Model Documentation, Module VI), so they compare crops on one scale but
are not local market prices.

  python3 -m pip install rasterio numpy
  python3 scripts/build-gaez.py /tmp/gaez-cache
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio import features

ROOT = Path(__file__).resolve().parent.parent
BUCKET = "https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/MAPSET"
NE50 = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"

# GAEZ v5 crop codes (dimension CROP-RES06) and international prices, I$2015 per tonne
# (Module VI, "Crop Groups with Crops and Average Prices"). Fodder crops have no price.
CROPS = {
    "BAN": 366.06, "BRL": 194.83, "COC": 1471.52, "COF": 2089.67, "CON": 163.21,
    "COT": 900.90, "CSV": 145.28, "FDD": None, "FRT": 949.22, "GRD": 723.77,
    "MLT": 300.10, "MZE": 200.73, "NES": 1250.72, "OCE": 491.08, "OLP": 97.94,
    "OOC": 668.23, "ORT": 443.15, "OVG": 564.11, "PLS": 589.10, "POT": 228.48,
    "RCW": 391.07, "RSD": 470.18, "RUB": 1256.88, "SES": 1132.69, "SFL": 488.09,
    "SOY": 382.46, "SRG": 217.23, "SUB": 47.11, "SUC": 44.88, "TEA": 1127.01,
    "TOB": 2239.66, "TOM": 476.12, "WHE": 236.83,
}


def fetch(url, dest):
    if not dest.exists():
        print("downloading", url)
        urllib.request.urlretrieve(url, dest)
    return dest


def read(cache, mapset, code, water="WST"):
    f = fetch(f"{BUCKET}/{mapset}/GAEZ-V5.{mapset}.{code}.{water}.tif", cache / f"{mapset}.{code}.{water}.tif")
    with rasterio.open(f) as r:
        a = r.read(1).astype(np.float64)
        transform, shape = r.transform, r.shape
    a[~np.isfinite(a)] = 0
    a[a < 0] = 0
    return a, transform, shape


def iso3(p):
    v = p.get("ISO_A3_EH")
    return v if v and v != "-99" else p["ADM0_A3"]


def main(cache):
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    ne = json.loads(fetch(NE50, cache / "ne50.geojson").read_text())
    codes = sorted({iso3(f["properties"]) for f in ne["features"]})
    index = {c: i + 1 for i, c in enumerate(codes)}

    _, transform, shape = read(cache, "RES06-HAR", "ALL")
    grid = features.rasterize(
        ((f["geometry"], index[iso3(f["properties"])]) for f in ne["features"]),
        out_shape=shape,
        transform=transform,
        dtype="int32",
    )
    n = len(codes) + 1
    by_country = lambda a: np.bincount(grid.ravel(), weights=a.ravel(), minlength=n)

    # Stored values are in thousands (hectares, tonnes, I$), per each mapset's "scale".
    total_area = by_country(read(cache, "RES06-HAR", "ALL")[0]) * 1000
    irrigated = by_country(read(cache, "RES06-HAR", "ALL", "WSI")[0]) * 1000
    value = by_country(read(cache, "RES06-VAL", "ALL")[0]) * 1000
    crop_area, crop_prod = {}, {}
    for code in CROPS:
        crop_area[code] = by_country(read(cache, "RES06-HAR", code)[0]) * 1000
        crop_prod[code] = by_country(read(cache, "RES06-PRD", code)[0]) * 1000

    countries = {}
    for c, i in index.items():
        if total_area[i] < 1:
            continue
        rows = []
        for code in CROPS:
            a, p = crop_area[code][i], crop_prod[code][i]
            if a >= 1:
                rows.append([code, round(a), round(p)])
        rows.sort(key=lambda r: -r[1])
        countries[c] = {
            "area": round(total_area[i]),
            "irrigated": round(irrigated[i] / total_area[i], 3),
            "value": round(value[i]),
            "crops": rows,
        }

    doc = {
        "source": "FAO GAEZ v5, Actual yields and production (year 2020, FAOSTAT 2019-2021), summed by country",
        "fields": {"crops": ["code", "harvestedHa", "productionT"]},
        "prices": CROPS,
        "countries": countries,
    }
    out = ROOT / "src/data/gaez-countries.json"
    out.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"{len(countries)} countries, {out.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main(sys.argv[1])
