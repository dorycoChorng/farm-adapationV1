import { BUNDLED_RATES, convert, countryCurrency, fetchRates, formatAmount, formatLargeMoney, formatMoney } from '../currency';

const rates = { date: '2026-01-01', rates: { USD: 1, KHR: 4000, THB: 32, EUR: 0.9 } };

describe('currency', () => {
  it('knows each country’s money from the bundled table', () => {
    expect(countryCurrency('KHM')).toBe('KHR');
    expect(countryCurrency('THA')).toBe('THB');
    expect(countryCurrency('USA')).toBe('USD');
    expect(countryCurrency(null)).toBeNull();
    expect(BUNDLED_RATES.rates.USD).toBe(1);
    expect(BUNDLED_RATES.rates.KHR).toBeGreaterThan(1000);
  });

  it('converts and formats with the right symbol', () => {
    expect(convert(10, 'KHR', rates)).toBe(40000);
    expect(convert(10, 'XYZ', rates)).toBeNull();
    expect(formatMoney(1366, 'USD', rates)).toBe('$1,366');
    expect(formatMoney(1366, 'KHR', rates)).toBe('5,460,000 ៛');
    expect(formatMoney(250, 'THB', rates)).toBe('8,000 ฿');
    expect(formatMoney(100, 'EUR', rates)).toBe('€90');
    // No rate: falls back to US$.
    expect(formatMoney(100, 'XYZ', rates)).toBe('$100');
    expect(formatAmount(12.5, 'GBP', 1)).toBe('£12.5');
    expect(formatAmount(5, 'MYR')).toBe('5 MYR');
  });

  it('writes large totals with a scale word', () => {
    const words = (big: boolean, v: string) => `${v} ${big ? 'billion' : 'million'}`;
    expect(formatLargeMoney(5.2e9, 'USD', words, rates)).toBe('$5.2 billion');
    expect(formatLargeMoney(5.2e9, 'KHR', words, rates)).toBe('20,800 billion ៛');
    expect(formatLargeMoney(3.4e7, 'USD', words, rates)).toBe('$34 million');
  });

  it('takes fresh rates from the first mirror that answers', async () => {
    const calls: string[] = [];
    const get = (async (url: string) => {
      calls.push(url);
      if (calls.length === 1) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ date: '2026-10-20', usd: { khr: 4100, thb: 33, zzz: 5 } }) };
    }) as unknown as typeof fetch;
    const fresh = await fetchRates(get);
    expect(calls).toHaveLength(2);
    expect(fresh).toEqual({ date: '2026-10-20', rates: { KHR: 4100, THB: 33, USD: 1 } });
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchRates(offline)).toBeNull();
  });
});
