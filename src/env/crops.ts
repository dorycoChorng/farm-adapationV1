import catalogue from '../data/ecocrop.json';

/**
 * Crop requirement profiles: every food crop in the FAO ECOCROP database that has
 * complete temperature, rainfall and pH ranges (built by scripts/build-crops.py).
 * Values are ECOCROP's, copied unchanged. ECOCROP ranges are general for each species,
 * not for local varieties, and have not been reviewed by a local agronomist, so the app
 * labels results as indicative.
 */

/** A trapezoid: 0 outside [absMin, absMax], 1 inside [optMin, optMax], linear in between. */
export interface Range {
  absMin: number;
  optMin: number;
  optMax: number;
  absMax: number;
}

export type FactorKey = 'rain' | 'temp' | 'ph';
export type CropCategory = 'cereals' | 'pulses' | 'roots' | 'vegetables' | 'fruits' | 'other';
export const CROP_CATEGORIES: CropCategory[] = ['cereals', 'pulses', 'roots', 'vegetables', 'fruits', 'other'];

export interface CropProfile {
  id: string;
  scientific: string;
  category: CropCategory;
  /** English common name (curated, else ECOCROP's); null shows the scientific name. */
  en: string | null;
  /** Khmer name, for well-known crops only. */
  km: string | null;
  /** A well-known crop with curated names: listed first among equal scores. */
  known: boolean;
  /** ECOCROP common names in many languages, used for search. */
  commonNames: string[];
  /**
   * Rainfall (mm over the growing period), mean temperature during growth (°C) and
   * soil pH. ECOCROP's rainfall range is compared with rain over the growing season,
   * as in Hijmans' ECOCROP model (R packages dismo and Recocrop).
   */
  needs: Record<FactorKey, Range>;
  /** Days from sowing to harvest (shortest, longest); null when ECOCROP has none. */
  cycleDays: [number, number] | null;
  ecocropId: number;
}

type Row = [string, string, CropCategory, string | null, string | null, string, number[], number[], number[], [number, number] | null, number, number];

const toRange = ([absMin, optMin, optMax, absMax]: number[]): Range => ({ absMin, optMin, optMax, absMax });

export const CROPS: CropProfile[] = (catalogue.crops as unknown as Row[]).map(([id, scientific, category, en, km, names, temp, rain, ph, cycleDays, ecocropId, known]) => ({
  id,
  scientific,
  category,
  en,
  km,
  known: known === 1,
  commonNames: names ? names.split('|') : [],
  needs: { rain: toRange(rain), temp: toRange(temp), ph: toRange(ph) },
  cycleDays,
  ecocropId,
}));

export const CROP_PROFILE_VERSION = 4;
export const CROP_PROFILE_SOURCE = catalogue.source;

const byId = new Map(CROPS.map((c) => [c.id, c]));
export const cropById = (id: string) => byId.get(id);

/**
 * Months from sowing to harvest: the middle of ECOCROP's growing-period range, rounded.
 * Perennials and crops with no growing period are judged on the whole year.
 */
export function cycleMonths(crop: Pick<CropProfile, 'cycleDays'>): number {
  if (!crop.cycleDays) return 12;
  const days = (crop.cycleDays[0] + crop.cycleDays[1]) / 2;
  return Math.min(12, Math.max(1, Math.round(days / 30.4)));
}

const EMOJI: Record<string, string> = {
  rice: '🌾',
  maize: '🌽',
  wheat: '🌾',
  banana: '🍌',
  mango: '🥭',
  pineapple: '🍍',
  coconut: '🥥',
  tomato: '🍅',
  chilli: '🌶️',
  'bird-chilli': '🌶️',
  eggplant: '🍆',
  cucumber: '🥒',
  watermelon: '🍉',
  melon: '🍈',
  grape: '🍇',
  apple: '🍎',
  orange: '🍊',
  mandarin: '🍊',
  lime: '🍋',
  groundnut: '🥜',
  avocado: '🥑',
  potato: '🥔',
  'sweet-potato': '🍠',
  carrot: '🥕',
  onion: '🧅',
  garlic: '🧄',
  'coffee-arabica': '☕',
  'coffee-robusta': '☕',
  tea: '🍵',
  lettuce: '🥬',
  broccoli: '🥦',
  ginger: '🫚',
  sunflower: '🌻',
  lotus: '🪷',
  // Grains and beans that look like the emoji.
  sorghum: '🌾',
  'pearl-millet': '🌾',
  barley: '🌾',
  oats: '🌾',
  soybean: '🫘',
  'common-bean': '🫘',
  mungbean: '🫘',
  'black-gram': '🫘',
  cowpea: '🫘',
  'pigeon-pea': '🫘',
  chickpea: '🫘',
  lentil: '🫘',
  // Leafy greens.
  cabbage: '🥬',
  'pak-choi': '🥬',
  'mustard-greens': '🥬',
  spinach: '🥬',
  'water-spinach': '🥬',
  amaranth: '🥬',
  cauliflower: '🥦',
  // Herbs and leaves.
  basil: '🌿',
  coriander: '🌿',
  lemongrass: '🌿',
  moringa: '🌿',
  // Others with a matching emoji.
  pumpkin: '🎃',
  pomelo: '🍊',
  sugarcane: '🎋',
  cocoa: '🍫',
  'oil-palm': '🌴',
  'sugar-palm': '🌴',
};
/**
 * Category emoji only where the whole category looks alike (grains, beans). For the
 * rest a plain seedling, so no crop shows a fruit or vegetable it isn't; the photo on
 * each crop card shows the real plant.
 */
const CATEGORY_EMOJI: Record<CropCategory, string> = {
  cereals: '🌾',
  pulses: '🫘',
  roots: '🌱',
  vegetables: '🌱',
  fruits: '🌱',
  other: '🌱',
};
export const cropEmoji = (crop: CropProfile) => EMOJI[crop.id] ?? CATEGORY_EMOJI[crop.category];

export function cropName(crop: CropProfile, language: 'en' | 'km'): string {
  return (language === 'km' ? crop.km : null) ?? crop.en ?? crop.scientific;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export interface CropMatch {
  crop: CropProfile;
  /** The common name that matched, when it isn't the name the app already shows. */
  matched: string | null;
  /** 0 exact, 1 starts with, 2 a word starts with, 3 contains. */
  rank: number;
}

/** Crops whose display, scientific or ECOCROP common names match the query, best match first. */
export function searchCrops(query: string, crops: CropProfile[] = CROPS): CropMatch[] {
  const q = fold(query);
  if (!q) return [];
  const rankOf = (name: string) => {
    const n = fold(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.split(/[\s\-/(]+/).some((w) => w.startsWith(q))) return 2;
    return n.includes(q) ? 3 : -1;
  };
  const out: CropMatch[] = [];
  for (const crop of crops) {
    let best: CropMatch | null = null;
    const names: { name: string | null; shown: boolean }[] = [
      { name: crop.en, shown: true },
      { name: crop.km, shown: true },
      { name: crop.scientific, shown: true },
      ...crop.commonNames.map((name) => ({ name, shown: false })),
    ];
    for (const { name, shown } of names) {
      if (!name) continue;
      const rank = rankOf(name);
      if (rank >= 0 && (!best || rank < best.rank)) best = { crop, matched: shown ? null : name, rank };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.rank - b.rank || Number(!a.crop.known) - Number(!b.crop.known));
}

/**
 * Order for crop lists: higher score first; among equal scores, crops with a curated
 * name (the ones farmers know) before the rest, then by id.
 */
export function byScore(a: { cropId: string; score: number | null }, b: { cropId: string; score: number | null }): number {
  const known = (id: string) => (cropById(id)?.known ? 0 : 1);
  return (b.score ?? -1) - (a.score ?? -1) || known(a.cropId) - known(b.cropId) || a.cropId.localeCompare(b.cropId);
}
