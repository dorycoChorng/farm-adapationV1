import type { LatLng } from '../geo/types';
import type { ClimateData, RainHistory } from './types';

/**
 * NASA POWER point API. Documented at https://power.larc.nasa.gov/docs/services/api/
 * Parsers read units from the response instead of assuming them, because POWER
 * reports some parameters in different units per user community.
 */

export const POWER_BASE = 'https://power.larc.nasa.gov/api/temporal';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function climatologyUrl(p: LatLng) {
  const q = new URLSearchParams({
    parameters: 'PRECTOTCORR,ALLSKY_SFC_SW_DWN,T2M,T2M_MAX,T2M_MIN',
    community: 'RE',
    longitude: p.longitude.toFixed(4),
    latitude: p.latitude.toFixed(4),
    format: 'JSON',
  });
  return `${POWER_BASE}/climatology/point?${q}`;
}

export function monthlyRainUrl(p: LatLng, startYear: number, endYear: number) {
  const q = new URLSearchParams({
    parameters: 'PRECTOTCORR',
    community: 'RE',
    longitude: p.longitude.toFixed(4),
    latitude: p.latitude.toFixed(4),
    start: String(startYear),
    end: String(endYear),
    format: 'JSON',
  });
  return `${POWER_BASE}/monthly/point?${q}`;
}

/** The last calendar year POWER's monthly product is expected to have complete. */
export function lastCompleteYear(now: Date) {
  return now.getUTCMonth() >= 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
}

interface PowerResponse {
  properties?: { parameter?: Record<string, Record<string, number>> };
  parameters?: Record<string, { units?: string }>;
  header?: { fill_value?: number; start?: string; end?: string; range?: string };
  messages?: string[];
}

function asPower(json: unknown): PowerResponse {
  const r = json as PowerResponse;
  if (!r || typeof r !== 'object' || !r.properties?.parameter) {
    const msg = (json as { messages?: string[]; detail?: unknown })?.messages?.join(' ');
    throw new Error(msg || 'unexpected NASA POWER response');
  }
  return r;
}

const fillOf = (r: PowerResponse) => r.header?.fill_value ?? -999;
const clean = (v: number | undefined, fill: number) => (v === undefined || v === null || v === fill || !Number.isFinite(v) ? null : v);

/** Convert a solar value to kWh/m²/day from whatever unit the response states. */
export function toKwhPerDay(value: number, units: string | undefined) {
  return units && /MJ/i.test(units) ? value / 3.6 : value;
}

/** Convert a rainfall value to a monthly total in mm. */
export function toMonthlyMm(value: number, units: string | undefined, monthIndex: number, year?: number) {
  const days = year === undefined ? DAYS_IN_MONTH[monthIndex] : new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return units && /day/i.test(units) ? value * days : value;
}

const round = (v: number | null, digits = 1) => (v === null ? null : Number(v.toFixed(digits)));
const sumOrNull = (values: (number | null)[]) => (values.some((v) => v === null) ? null : values.reduce<number>((a, b) => a + (b ?? 0), 0));
const meanOrNull = (values: (number | null)[]) => {
  const s = sumOrNull(values);
  return s === null ? null : s / values.length;
};

export function parseClimatology(json: unknown): ClimateData {
  const r = asPower(json);
  const p = r.properties!.parameter!;
  const fill = fillOf(r);
  const units = (k: string) => r.parameters?.[k]?.units;
  const series = (k: string) => MONTHS.map((m) => clean(p[k]?.[m], fill));

  const rain = series('PRECTOTCORR').map((v, i) => (v === null ? null : toMonthlyMm(v, units('PRECTOTCORR'), i)));
  const solar = series('ALLSKY_SFC_SW_DWN').map((v) => (v === null ? null : toKwhPerDay(v, units('ALLSKY_SFC_SW_DWN'))));
  const temp = series('T2M');
  const annual = (k: string) => clean(p[k]?.ANN, fill);
  const solarAnn = annual('ALLSKY_SFC_SW_DWN');

  const h = r.header ?? {};
  const period = h.start && h.end ? `${h.start.slice(0, 4)}–${h.end.slice(0, 4)}` : (h.range ?? 'not stated by source');

  return {
    monthlyRainMm: rain.map((v) => round(v, 0)),
    annualRainMm: round(sumOrNull(rain), 0),
    monthlySolarKwhM2Day: solar.map((v) => round(v, 2)),
    annualSolarKwhM2Day: round(solarAnn === null ? meanOrNull(solar) : toKwhPerDay(solarAnn, units('ALLSKY_SFC_SW_DWN')), 2),
    monthlyTempC: temp.map((v) => round(v, 1)),
    annualTempC: round(annual('T2M') ?? meanOrNull(temp), 1),
    annualTempMaxC: round(annual('T2M_MAX'), 1),
    annualTempMinC: round(annual('T2M_MIN'), 1),
    period,
  };
}

/** Yearly rainfall totals from the monthly endpoint; years with any missing month are dropped. */
export function parseMonthlyRain(json: unknown): RainHistory {
  const r = asPower(json);
  const values = r.properties!.parameter!.PRECTOTCORR ?? {};
  const units = r.parameters?.PRECTOTCORR?.units;
  const fill = fillOf(r);
  const byYear = new Map<number, (number | null)[]>();
  for (const [key, raw] of Object.entries(values)) {
    if (!/^\d{6}$/.test(key)) continue;
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4)) - 1;
    if (month < 0 || month > 11) continue; // month 13 is POWER's annual value
    const months = byYear.get(year) ?? new Array<number | null>(12).fill(null);
    const v = clean(raw, fill);
    months[month] = v === null ? null : toMonthlyMm(v, units, month, year);
    byYear.set(year, months);
  }
  const years = [...byYear.entries()]
    .map(([year, months]) => ({ year, total: sumOrNull(months) }))
    .filter((y): y is { year: number; total: number } => y.total !== null)
    .sort((a, b) => a.year - b.year)
    .map((y) => ({ year: y.year, totalMm: Math.round(y.total) }));
  return { years };
}
