import type { LatLng } from '../geo/types';
import type { HwsdData } from './types';

/**
 * Second soil estimate: FAO's Harmonized World Soil Database v2.0, bundled for Cambodia
 * and its borders (scripts/build-hwsd.py), so it works offline. It maps soil mapping
 * units at about 1 km; each unit holds several soils, and this reports the dominant one
 * with its share. In Cambodia the units come from coarse regional maps, so this is a
 * broad picture of the area's main soil, not of one field.
 */

interface Unit {
  soil: string | null;
  share: number | null;
  texture: string | null;
  drainage: string | null;
  ph_water: number | null;
  org_carbon: number | null;
  clay: number | null;
  sand: number | null;
  silt: number | null;
  cec_soil: number | null;
  teb: number | null;
  bsat: number | null;
  total_n: number | null;
}

interface Table {
  west: number;
  north: number;
  cell: number;
  width: number;
  height: number;
  rle: number[];
  units: Record<string, Unit>;
}

const DRAINAGE: Record<string, string> = {
  'Excessively drained': 'E',
  'Somewhat excessively drained': 'SE',
  'Well drained': 'W',
  'Moderately well drained': 'MW',
  'Imperfectly drained': 'I',
  'Poorly drained': 'P',
  'Very poorly drained': 'VP',
};

/** HWSD's USDA texture name as the app's texture key, e.g. "Clay (heavy)" → "clay". */
export const hwsdTextureKey = (name: string | null) =>
  name
    ? name
        .replace(/\s*\(.*\)/, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
    : null;

let table: Table | null = null;
let grid: Uint16Array | null = null;

function load() {
  if (!table) {
    // Loaded on first use, so the 130 KB table isn't parsed at start-up.
    table = require('../data/hwsd-cambodia.json') as Table;
    grid = new Uint16Array(table.width * table.height);
    let at = 0;
    for (let i = 0; i < table.rle.length; i += 2) {
      grid.fill(table.rle[i], at, at + table.rle[i + 1]);
      at += table.rle[i + 1];
    }
  }
  return { t: table, g: grid! };
}

/** True when a point lies inside the bundled HWSD area. */
export function hwsdCovers(p: LatLng): boolean {
  const { t } = load();
  return p.longitude >= t.west && p.longitude < t.west + t.width * t.cell && p.latitude <= t.north && p.latitude > t.north - t.height * t.cell;
}

/** The dominant soil at a point; null outside the bundled area or where HWSD has no soil data (water, towns). */
export function readHwsd(p: LatLng): HwsdData | null {
  if (!hwsdCovers(p)) return null;
  const { t, g } = load();
  const row = Math.floor((t.north - p.latitude) / t.cell);
  const col = Math.floor((p.longitude - t.west) / t.cell);
  const id = g[row * t.width + col];
  const u = id ? t.units[String(id)] : undefined;
  if (!u || u.ph_water === null) return null;
  return {
    unitId: id,
    soil: u.soil,
    sharePct: u.share,
    texture: u.texture,
    drainage: u.drainage ? (DRAINAGE[u.drainage.trim()] ?? null) : null,
    ph: u.ph_water,
    organicCarbonPct: u.org_carbon,
    clayPct: u.clay,
    sandPct: u.sand,
    siltPct: u.silt,
    cec: u.cec_soil,
    baseSaturationPct: u.bsat,
    nitrogenGKg: u.total_n,
  };
}
