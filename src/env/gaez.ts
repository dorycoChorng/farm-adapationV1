import table from '../data/gaez-countries.json';
import type { LatLng } from '../geo/types';
import type { CropProfile } from './crops';
import { cog } from './rasters';
import { type FetchRange, fetchRange, pixelFor, readPixel } from './tiff';
import type { LocalProductionData } from './types';

/**
 * What farmers actually grow, and what it is worth, from FAO GAEZ v5 "Actual yields
 * and production": FAOSTAT 2019–2021 statistics spread over cropland at about 10 km
 * (5 arc-minutes) for 33 crops and crop groups. Country totals are bundled
 * (scripts/build-gaez.py); the cell at a place is read from FAO's files online.
 *
 * Values use the international prices GAEZ lists per crop group (constant 2014–2016
 * international dollars, I$, per tonne). They put crops on one scale for comparison;
 * they are not today's local market prices and do not subtract any costs.
 */

export const GAEZ_CODES = [
  'BAN', 'BRL', 'COC', 'COF', 'CON', 'COT', 'CSV', 'FDD', 'FRT', 'GRD', 'MLT', 'MZE', 'NES', 'OCE', 'OLP', 'OOC', 'ORT',
  'OVG', 'PLS', 'POT', 'RCW', 'RSD', 'RUB', 'SES', 'SFL', 'SOY', 'SRG', 'SUB', 'SUC', 'TEA', 'TOB', 'TOM', 'WHE',
] as const;
export type GaezCode = (typeof GAEZ_CODES)[number];

/** Crop groups made of many different crops; their yields and values are group averages. */
export const GAEZ_GROUPS = new Set<GaezCode>(['FRT', 'OVG', 'NES', 'PLS', 'OCE', 'OOC', 'ORT', 'FDD']);

export const GAEZ_SOURCE = table.source;
export const GAEZ_BASE = 'https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/MAPSET';
/** International price, I$ (2014–2016) per tonne; null for fodder, which GAEZ does not price. */
export const GAEZ_PRICES = table.prices as Record<GaezCode, number | null>;

export interface CountryProduction {
  /** Harvested area of all crops, ha (a field cropped twice counts twice). */
  areaHa: number;
  irrigatedShare: number;
  /** Value of all crop production, I$ (2014–2016 prices). */
  valueUsd: number;
  crops: { code: GaezCode; areaHa: number; productionT: number; yieldT: number; valuePerHa: number | null }[];
}

type Raw = { area: number; irrigated: number; value: number; crops: [GaezCode, number, number][] };
const COUNTRIES = table.countries as unknown as Record<string, Raw>;

export function countryProduction(iso3: string | null): CountryProduction | null {
  const c = iso3 ? COUNTRIES[iso3] : undefined;
  if (!c) return null;
  return {
    areaHa: c.area,
    irrigatedShare: c.irrigated,
    valueUsd: c.value,
    crops: c.crops.map(([code, areaHa, productionT]) => {
      const yieldT = productionT / areaHa;
      const price = GAEZ_PRICES[code];
      return { code, areaHa, productionT, yieldT, valuePerHa: price === null ? null : yieldT * price };
    }),
  };
}

/** Countries with GAEZ data, for the country comparison list. */
export const GAEZ_COUNTRIES = Object.keys(COUNTRIES);

// ------------------------------------------------------------ crops ↔ GAEZ codes

const BY_CROP: Record<string, GaezCode> = {
  rice: 'RCW', maize: 'MZE', wheat: 'WHE', sorghum: 'SRG', 'pearl-millet': 'MLT', barley: 'BRL', oats: 'OCE',
  cassava: 'CSV', potato: 'POT', 'sweet-potato': 'POT', yam: 'ORT', taro: 'ORT', soybean: 'SOY', groundnut: 'GRD',
  sesame: 'SES', sunflower: 'SFL', sugarcane: 'SUC', banana: 'BAN', coconut: 'CON', 'oil-palm': 'OLP',
  'coffee-arabica': 'COF', 'coffee-robusta': 'COF', cocoa: 'COC', tea: 'TEA', tomato: 'TOM',
  'black-pepper': 'NES', ginger: 'NES', turmeric: 'NES', galangal: 'NES', lemongrass: 'NES',
};
const BY_CATEGORY: Partial<Record<CropProfile['category'], GaezCode>> = {
  pulses: 'PLS',
  vegetables: 'OVG',
  fruits: 'FRT',
  roots: 'ORT',
  cereals: 'OCE',
};

/** The GAEZ crop or crop group a catalogue crop belongs to, if any. */
export function gaezCodeFor(crop: Pick<CropProfile, 'id' | 'category'>): GaezCode | null {
  return BY_CROP[crop.id] ?? BY_CATEGORY[crop.category] ?? null;
}

// ------------------------------------------------------------ the cell at a place

/** How many of the country's main crops are read at the place, and yields for how many. */
const LOCAL_CROPS = 10;
const LOCAL_YIELDS = 5;
/** GAEZ COG headers fit in 16 KB; the default 64 KB would quadruple the download. */
const HEADER_BYTES = 16384;
/** Stored values are thousands of hectares (per the mapset's "scale" of 1000). */
const AREA_SCALE = 1000;
/** Area of a 5 arc-minute cell in hectares at a latitude. */
export const cellAreaHa = (latitude: number) => (((5 / 60) * Math.PI) / 180) ** 2 * 6371008.8 ** 2 * Math.cos((latitude * Math.PI) / 180) / 1e4;

export const gaezUrl = (mapset: 'RES06-HAR' | 'RES06-YLD', code: GaezCode | 'ALL') => `${GAEZ_BASE}/${mapset}/GAEZ-V5.${mapset}.${code}.WST.tif`;

async function valueAt(url: string, p: LatLng, get: FetchRange): Promise<number | null> {
  const info = await cog(url, get, HEADER_BYTES);
  const px = pixelFor(info, p.longitude, p.latitude);
  if (!px) return null;
  const v = await readPixel(info, px[0], px[1], get);
  return v === null || !Number.isFinite(v) || v <= 0 ? null : v;
}

/** Fallback list where the country is unknown: the most widely grown crops worldwide. */
const WORLD_MAIN: GaezCode[] = ['WHE', 'MZE', 'RCW', 'SOY', 'OVG', 'FRT', 'PLS', 'SRG', 'CSV', 'SUC'];

interface CambodiaGrid {
  west: number;
  north: number;
  cell: number;
  width: number;
  height: number;
  runs: number[];
  all: number[];
  crops: Record<string, { ha: number[]; yield: number[] }>;
}

let cambodia: { grid: CambodiaGrid; slot: Map<number, number> } | null = null;

/** The bundled Cambodian cells (scripts/build-gaez-cambodia.py), loaded on first use. */
function cambodiaGrid() {
  if (!cambodia) {
    const grid = require('../data/gaez-cambodia.json') as CambodiaGrid;
    const slot = new Map<number, number>();
    let at = 0;
    let n = 0;
    for (let i = 0; i < grid.runs.length; i += 2) {
      at += grid.runs[i];
      for (let k = 0; k < grid.runs[i + 1]; k++) slot.set(at++, n++);
    }
    cambodia = { grid, slot };
  }
  return cambodia;
}

/**
 * The cell around a place in Cambodia from the bundled copy of the same GAEZ files:
 * instant and offline. Undefined when the place is outside the bundled cells.
 */
export function bundledLocalProduction(p: LatLng): LocalProductionData | null | undefined {
  const { grid, slot } = cambodiaGrid();
  const row = Math.floor((grid.north - p.latitude) / grid.cell);
  const col = Math.floor((p.longitude - grid.west) / grid.cell);
  if (row < 0 || col < 0 || row >= grid.height || col >= grid.width) return undefined;
  const i = slot.get(row * grid.width + col);
  if (i === undefined) return undefined;
  const totalHa = grid.all[i];
  if (!totalHa) return null;
  const crops = Object.entries(grid.crops)
    .map(([code, c]) => ({ code: code as GaezCode, harvestedHa: c.ha[i], yieldT: c.yield[i] ? c.yield[i] / 100 : null }))
    .filter((c) => c.harvestedHa >= 1)
    .sort((a, b) => b.harvestedHa - a.harvestedHa);
  return toLocal('KHM', p, totalHa, crops);
}

function toLocal(iso3: string | null, p: LatLng, totalHa: number, crops: { code: GaezCode; harvestedHa: number; yieldT: number | null }[]): LocalProductionData {
  return {
    country: iso3,
    cellAreaHa: Math.round(cellAreaHa(p.latitude)),
    harvestedHa: Math.round(totalHa),
    crops: crops.map((c) => {
      const price = GAEZ_PRICES[c.code];
      return {
        code: c.code,
        harvestedHa: Math.round(c.harvestedHa),
        share: Number((c.harvestedHa / totalHa).toFixed(3)),
        yieldT: c.yieldT === null ? null : Number(c.yieldT.toFixed(2)),
        valuePerHa: c.yieldT === null || price === null ? null : Math.round(c.yieldT * price),
      };
    }),
  };
}

/**
 * Harvested area of the main crops in the ~10 km cell around a place, with yields for
 * the biggest ones. In Cambodia this comes from the bundled copy (no download).
 * Elsewhere it reads one tile from each of about 16 of FAO's files (roughly 2 MB) in a
 * single round: yields for the country's main crops are requested alongside the areas
 * rather than after them, and only a local main crop the country list missed waits for
 * a second round. Null when the cell has no cropland in GAEZ.
 */
export async function readLocalProduction(p: LatLng, iso3: string | null, get: FetchRange = fetchRange): Promise<LocalProductionData | null> {
  if (iso3 === 'KHM') {
    const bundled = bundledLocalProduction(p);
    if (bundled !== undefined) return bundled;
  }
  return fetchLocalProduction(p, iso3, get);
}

/** The online path of readLocalProduction, reading FAO's files. */
export async function fetchLocalProduction(p: LatLng, iso3: string | null, get: FetchRange = fetchRange): Promise<LocalProductionData | null> {
  const country = countryProduction(iso3);
  const candidates = country ? country.crops.slice(0, LOCAL_CROPS).map((c) => c.code) : WORLD_MAIN;
  const yieldAt = new Map<GaezCode, Promise<number | null>>();
  const readYield = (code: GaezCode) => {
    if (!yieldAt.has(code)) yieldAt.set(code, valueAt(gaezUrl('RES06-YLD', code), p, get));
    return yieldAt.get(code)!;
  };
  // Started together: total, every candidate's area, and the likely main crops' yields.
  const totalP = valueAt(gaezUrl('RES06-HAR', 'ALL'), p, get);
  const areasP = Promise.all(candidates.map((code) => valueAt(gaezUrl('RES06-HAR', code), p, get)));
  for (const code of candidates.slice(0, LOCAL_YIELDS)) readYield(code).catch(() => null);
  const [total, areas] = await Promise.all([totalP, areasP]);
  if (total === null) return null;
  const crops = candidates
    .map((code, i) => ({ code, harvestedHa: (areas[i] ?? 0) * AREA_SCALE }))
    .filter((c) => c.harvestedHa >= 1)
    .sort((a, b) => b.harvestedHa - a.harvestedHa);
  const top = crops.slice(0, LOCAL_YIELDS);
  const yields = await Promise.all(top.map((c) => readYield(c.code)));
  return toLocal(
    iso3,
    p,
    total * AREA_SCALE,
    crops.map((c, i) => ({ ...c, yieldT: i < yields.length ? yields[i] : null })),
  );
}

export interface CropValue {
  code: GaezCode;
  /** True when the code is a crop group (vegetables, fruits…), so the figures are group averages. */
  group: boolean;
  yieldT: number;
  price: number;
  valuePerHa: number;
  /** Yield from the cell around the place, or the national average. */
  from: 'local' | 'country';
  /** Share of the harvested area around the place, when it is grown there. */
  localShare: number | null;
}

/**
 * Typical value of a hectare of a catalogue crop: yield (around the place when read,
 * else the national average) × FAO international price. Null when the crop has no GAEZ
 * code, the country has no figures for it, or GAEZ gives it no price.
 */
export function cropValue(
  crop: Pick<CropProfile, 'id' | 'category'>,
  local: LocalProductionData | null,
  iso3: string | null,
): CropValue | null {
  const code = gaezCodeFor(crop);
  if (!code) return null;
  const price = GAEZ_PRICES[code];
  if (price === null) return null;
  const here = local?.crops.find((c) => c.code === code);
  const national = countryProduction(iso3)?.crops.find((c) => c.code === code);
  const yieldT = here?.yieldT ?? national?.yieldT ?? null;
  if (yieldT === null || !(yieldT > 0)) return null;
  return {
    code,
    group: GAEZ_GROUPS.has(code),
    yieldT,
    price,
    valuePerHa: Math.round(yieldT * price),
    from: here?.yieldT != null ? 'local' : 'country',
    localShare: here ? here.share : null,
  };
}
