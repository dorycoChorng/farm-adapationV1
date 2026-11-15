import type { LatLng } from '../geo/types';
import type { SoilData, SoilProperty } from './types';

/**
 * ISRIC SoilGrids 2.0 REST API (https://rest.isric.org/soilgrids/v2.0/docs).
 * Values are model predictions, not measurements; the API also asks for fair use
 * (a few requests per minute), so the app only calls it when the user runs an analysis.
 */

export const SOILGRIDS_BASE = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const PROPS: SoilProperty['key'][] = ['phh2o', 'soc', 'clay', 'sand', 'silt', 'nitrogen', 'cec'];
const DEPTHS = ['0-5cm', '5-15cm', '15-30cm'];
/** Thickness of each depth interval, for the 0–30 cm weighted average. */
const THICKNESS: Record<string, number> = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15 };

/** Display units after dividing by the response's d_factor (SoilGrids "conventional units", e.g. clay g/kg ÷ 10 = %). */
const UNITS: Record<SoilProperty['key'], string> = {
  phh2o: 'pH',
  soc: 'g/kg',
  clay: '%',
  sand: '%',
  silt: '%',
  nitrogen: 'g/kg',
  cec: 'cmol(c)/kg',
};

export function soilGridsUrl(p: LatLng) {
  const q = new URLSearchParams({ lon: p.longitude.toFixed(5), lat: p.latitude.toFixed(5) });
  for (const prop of PROPS) q.append('property', prop);
  for (const d of DEPTHS) q.append('depth', d);
  for (const v of ['mean', 'Q0.05', 'Q0.95']) q.append('value', v);
  return `${SOILGRIDS_BASE}?${q}`;
}

interface SgLayer {
  name: string;
  unit_measure?: { d_factor?: number };
  depths?: { label: string; values?: Record<string, number | null> }[];
}

export function parseSoilGrids(json: unknown): SoilData {
  const layers = (json as { properties?: { layers?: SgLayer[] } })?.properties?.layers;
  if (!Array.isArray(layers)) throw new Error('unexpected SoilGrids response');

  const properties: SoilProperty[] = PROPS.map((key) => {
    const layer = layers.find((l) => l.name === key);
    const factor = layer?.unit_measure?.d_factor || 1;
    const weighted = (stat: string) => {
      let sum = 0;
      let weight = 0;
      for (const d of layer?.depths ?? []) {
        const v = d.values?.[stat];
        const w = THICKNESS[d.label];
        if (v === null || v === undefined || !w) return null; // any missing depth → no 0–30 cm value
        sum += (v / factor) * w;
        weight += w;
      }
      return weight === 30 ? Number((sum / weight).toFixed(1)) : null;
    };
    return { key, mean: weighted('mean'), low: weighted('Q0.05'), high: weighted('Q0.95'), unit: UNITS[key] };
  });

  const get = (k: SoilProperty['key']) => properties.find((p) => p.key === k)?.mean ?? null;
  const sand = get('sand');
  const silt = get('silt');
  const clay = get('clay');
  return {
    depth: '0–30 cm',
    properties,
    textureClass: sand !== null && silt !== null && clay !== null ? usdaTexture(sand, silt, clay) : null,
  };
}

/**
 * USDA soil texture class from sand/silt/clay percentages (normalised to 100).
 * Returns a translation key suffix such as "clay-loam".
 */
export function usdaTexture(sandIn: number, siltIn: number, clayIn: number): string {
  const total = sandIn + siltIn + clayIn;
  if (total <= 0) return 'unknown';
  const sand = (sandIn / total) * 100;
  const silt = (siltIn / total) * 100;
  const clay = (clayIn / total) * 100;
  if (silt + 1.5 * clay < 15) return 'sand';
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return 'loamy-sand';
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return 'sandy-loam';
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'loam';
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return 'silt-loam';
  if (silt >= 80 && clay < 12) return 'silt';
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'sandy-clay-loam';
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'clay-loam';
  if (clay >= 27 && clay < 40 && sand <= 20) return 'silty-clay-loam';
  if (clay >= 35 && sand > 45) return 'sandy-clay';
  if (clay >= 40 && silt >= 40) return 'silty-clay';
  return 'clay';
}
