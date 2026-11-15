import { cropById, cropEmoji, CROPS } from '../crops';
import { grownInCountry, isCommonCrop } from '../gaez';
import { goodSowMonths, monthRuns } from '../suitability';

describe('crops grown in a country', () => {
  const crop = (id: string) => cropById(id)!;

  it('keeps the main crops of Cambodia and drops ones it does not grow', () => {
    expect(grownInCountry(crop('rice'), 'KHM')).toBe(true);
    expect(grownInCountry(crop('cassava'), 'KHM')).toBe(true);
    expect(grownInCountry(crop('wheat'), 'KHM')).toBe(false);
    // Reported inside "other vegetables" rather than on its own.
    expect(grownInCountry(crop('tomato'), 'KHM')).toBe(true);
  });

  it('drops tropical crops where they are not grown', () => {
    expect(grownInCountry(crop('cassava'), 'ESP')).toBe(false);
    expect(grownInCountry(crop('wheat'), 'ESP')).toBe(true);
  });

  it('lists only well-known crops in the short list', () => {
    const list = CROPS.filter((c) => isCommonCrop(c, 'KHM'));
    expect(list.length).toBeGreaterThan(50);
    expect(list.length).toBeLessThan(100);
    expect(list.every((c) => c.known)).toBe(true);
    expect(list.map((c) => c.id)).not.toContain('wheat');
  });

  it('falls back to the well-known flag where the country is unknown', () => {
    expect(isCommonCrop(crop('rice'), null)).toBe(true);
  });
});

describe('sowing months', () => {
  it('groups months into runs over the new year', () => {
    expect(monthRuns([10, 11, 0, 1, 5])).toEqual([
      [5, 5],
      [10, 1],
    ]);
    expect(monthRuns([...Array(12).keys()])).toEqual([[0, 11]]);
    expect(monthRuns([])).toEqual([]);
  });

  it('keeps months scoring 50 or more', () => {
    const months = [...Array(12).keys()].map((m) => ({ month: m, score: m < 3 ? 80 : 20, rainMm: 0, tempC: 0, limiting: null, rainShort: false }));
    expect(goodSowMonths({ months })).toEqual([0, 1, 2]);
  });
});

describe('emoji', () => {
  it('never shows a fruit emoji for a fruit it is not', () => {
    expect(cropEmoji(cropById('pineapple')!)).toBe('🍍');
    const morula = CROPS.find((c) => c.scientific.startsWith('Sclerocarya'));
    if (morula) expect(cropEmoji(morula)).toBe('🌱');
  });
});
