import table from '../data/currencies.json';

/**
 * Money shown in the farmer's choice of currency. FAO's crop values are in international
 * dollars at 2014–2016 prices, which equal US dollars by definition, so US$ is the
 * default. Other currencies are converted at a daily exchange rate: bundled
 * (scripts/build-currencies.mjs) and refreshed online when possible.
 */

export interface Rates {
  /** Day the rates are for, YYYY-MM-DD. */
  date: string;
  /** Units of each currency per US dollar. */
  rates: Record<string, number>;
}

export const BUNDLED_RATES: Rates = { date: table.date, rates: table.rates as Record<string, number> };
export const CURRENCY_NAMES = table.names as Record<string, string>;
const BY_COUNTRY = table.byCountry as Record<string, string>;

/** The currency of a country (ISO 3166 alpha-3), when known. */
export const countryCurrency = (iso3: string | null): string | null => (iso3 ? (BY_COUNTRY[iso3] ?? null) : null);

const PREFIX: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹' };
const SUFFIX: Record<string, string> = { KHR: '៛', THB: '฿', VND: '₫', LAK: '₭' };

/** Converts US dollars to a currency; null when there is no rate for it. */
export function convert(usd: number, currency: string, rates: Rates = BUNDLED_RATES): number | null {
  if (currency === 'USD') return usd;
  const r = rates.rates[currency];
  return r ? usd * r : null;
}

/** "$1,366", "5,554,000 ៛", "45,800 THB". Large local amounts are rounded to 3 significant figures. */
export function formatAmount(amount: number, currency: string, digits = 0): string {
  const rounded = Math.abs(amount) >= 10000 && digits === 0 ? Number(amount.toPrecision(3)) : amount;
  const n = rounded.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  if (PREFIX[currency]) return `${PREFIX[currency]}${n}`;
  return `${n} ${SUFFIX[currency] ?? currency}`;
}

/** A US-dollar amount in the chosen currency, falling back to US$ when there is no rate. */
export function formatMoney(usd: number, currency: string, rates: Rates = BUNDLED_RATES, digits = 0): string {
  const v = convert(usd, currency, rates);
  return v === null ? formatAmount(usd, 'USD', digits) : formatAmount(v, currency, digits);
}

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
  // The source's documented fallback when the CDN fails.
  'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
];

/** Latest rates from the open exchange-rate feed; null when offline or both mirrors fail. */
export async function fetchRates(get: typeof fetch = fetch): Promise<Rates | null> {
  for (const url of SOURCES) {
    try {
      const res = await get(url);
      if (!res.ok) continue;
      const body = (await res.json()) as { date?: string; usd?: Record<string, number> };
      if (!body.date || !body.usd) continue;
      const rates: Record<string, number> = {};
      for (const code of Object.keys(BUNDLED_RATES.rates)) {
        const v = body.usd[code.toLowerCase()];
        if (typeof v === 'number' && v > 0) rates[code] = v;
      }
      rates.USD = 1;
      return { date: body.date, rates };
    } catch {
      // try the next mirror
    }
  }
  return null;
}

/** "$1.2 billion", "20,300 billion ៛": `scale` puts the number into a translated "{v} billion" / "{v} million" phrase. */
export function formatLargeMoney(usd: number, currency: string, scale: (big: boolean, v: string) => string, rates: Rates = BUNDLED_RATES): string {
  const converted = convert(usd, currency, rates);
  const code = converted === null ? 'USD' : currency;
  const v = converted ?? usd;
  const big = Math.abs(v) >= 1e9;
  const n = v / (big ? 1e9 : 1e6);
  const text = scale(big, n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 }));
  return PREFIX[code] ? `${PREFIX[code]}${text}` : `${text} ${SUFFIX[code] ?? code}`;
}
