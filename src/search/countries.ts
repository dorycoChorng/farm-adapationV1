import countries from '../data/countries.json';
import type { PlaceResult } from './types';

interface CountryEntry {
  name: string;
  nameLong: string;
  iso2: string | null;
  iso3: string;
  /** Khmer name (Unicode CLDR, via the i18n-iso-countries package). */
  km?: string;
  bbox: number[];
  label: number[];
}

const COUNTRIES = countries as CountryEntry[];

function toPlace(c: CountryEntry): PlaceResult {
  return {
    id: `country:${c.iso3}`,
    name: c.name,
    displayName: c.nameLong,
    nameKm: c.km ?? null,
    latitude: c.label[1],
    longitude: c.label[0],
    bbox: [c.bbox[0], c.bbox[1], c.bbox[2], c.bbox[3]],
    kind: 'country',
    source: 'country-index',
  };
}

/** Offline country lookup from the bundled Natural Earth 1:110m index (coarse extents). */
export function searchCountries(query: string, limit = 5): PlaceResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: { c: CountryEntry; score: number }[] = [];
  for (const c of COUNTRIES) {
    const names = [c.name, c.nameLong, c.km ?? ''].map((n) => n.toLowerCase());
    let score = 0;
    if (c.iso3.toLowerCase() === q || c.iso2?.toLowerCase() === q) score = 3;
    else if (names.some((n) => n === q)) score = 3;
    else if (names.some((n) => n.startsWith(q))) score = 2;
    else if (names.some((n) => n.includes(q))) score = 1;
    if (score > 0) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((s) => toPlace(s.c));
}

export function countryByIso3(iso3: string): PlaceResult | null {
  const c = COUNTRIES.find((x) => x.iso3 === iso3);
  return c ? toPlace(c) : null;
}

/** The "Go to Cambodia" shortcut target, from the bundled country index. */
export function cambodia(): PlaceResult {
  const kh = countryByIso3('KHM');
  if (!kh) throw new Error('Cambodia missing from the bundled country index');
  return kh;
}
