"""Builds src/map/web/places.json: the map's place-name labels.

Sources (both public domain, Natural Earth 1:10m, https://www.naturalearthdata.com):
  ne_10m_populated_places_simple.geojson and ne_10m_admin_1_states_provinces.geojson
from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson, plus country
label points and Khmer names from src/data/countries.json and the hand-made
scripts/data/places-km.json (Cambodian towns and provinces in Khmer).

Usage: python3 scripts/build-places.py <dir with the two geojson files>
Each label is [kind, lon, lat, minzoom, name, khmer-or-null], kinds:
0 country, 1 capital, 2 province, 3 city, 4 town.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1])
km = json.loads((ROOT / 'scripts/data/places-km.json').read_text())
countries = json.loads((ROOT / 'src/data/countries.json').read_text())

# Detail kept around Cambodia; elsewhere only the larger places (NE scalerank ≤ 6).
REGION = {'KHM', 'THA', 'LAO', 'VNM'}
out = []

for c in countries:
    w, s, e, n = c['bbox']
    area = max(0.01, (e - w) * (n - s) * math.cos(math.radians((s + n) / 2)))
    # Big countries are named from the whole-globe view, small ones once zoomed in.
    minzoom = 0.8 if area > 400 else 1.6 if area > 60 else 2.6 if area > 8 else 3.6
    out.append([0, round(c['label'][0], 3), round(c['label'][1], 3), minzoom, c['name'], c.get('km')])

for f in json.loads((src / 'ne_10m_populated_places_simple.geojson').read_text())['features']:
    p = f['properties']
    a3 = p['adm0_a3']
    if p['scalerank'] > 6 and a3 not in REGION:
        continue
    lon, lat = f['geometry']['coordinates']
    name, khmer = p['name'], None
    if a3 == 'KHM' and name in km['towns']:
        name, khmer = km['towns'][name]
    capital = p['adm0cap'] == 1 or p['featurecla'] == 'Admin-0 capital'
    kind = 1 if capital else 3 if p['scalerank'] <= 4 or p['pop_max'] >= 500000 else 4
    # NE's min_zoom is tuned for web maps; region towns show a little earlier.
    minzoom = float(p['min_zoom'])
    if a3 in REGION:
        minzoom = min(minzoom, 6.0)
    if capital:
        minzoom = min(minzoom, 3.0)
    out.append([kind, round(lon, 3), round(lat, 3), minzoom, name, khmer])

for t in km['extraTowns']:
    out.append([3 if t['kind'] == 'city' else 4, t['lon'], t['lat'], 6.0, t['name'], t['km']])

for f in json.loads((src / 'ne_10m_admin_1_states_provinces.geojson').read_text())['features']:
    p = f['properties']
    if p['adm0_a3'] not in REGION or p['latitude'] is None:
        continue
    name, khmer = p.get('name_en') or p['name'], None
    if p['adm0_a3'] == 'KHM':
        if p['name'] not in km['provinces']:
            raise SystemExit(f"no Khmer name for province {p['name']}")
        name, khmer = km['provinces'][p['name']]
        if name == 'Phnom Penh':
            continue  # the city label covers it
    out.append([2, round(p['longitude'], 3), round(p['latitude'], 3), 6.2, name, khmer])

out.sort(key=lambda r: (r[0], r[3]))
dest = ROOT / 'src/map/web/places.json'
dest.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
print(len(out), 'labels,', dest.stat().st_size // 1024, 'KiB')
