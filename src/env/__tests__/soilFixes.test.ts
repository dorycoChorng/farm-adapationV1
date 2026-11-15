import { coastDistanceKm, monthlyEt0, saltRisk } from '../salinity';
import { soilFixPlan } from '../soilFixes';
import type { EnvSummary, SoilProperty } from '../types';

const at = '2026-01-01T00:00:00.000Z';

function summary(over: {
  lat: number;
  lon: number;
  elevation?: number;
  slope?: number;
  soil?: Partial<Record<SoilProperty['key'], number>>;
  mangrove?: number;
  rain?: number[];
}): EnvSummary {
  const rain = over.rain ?? [10, 15, 40, 90, 180, 200, 210, 220, 260, 230, 120, 40];
  const props = Object.entries(over.soil ?? {}).map(([key, mean]) => ({ key, mean, low: null, high: null, unit: '' })) as SoilProperty[];
  const fractions = over.mangrove ? [{ code: 40, fraction: 1 - over.mangrove }, { code: 95, fraction: over.mangrove }] : [{ code: 40, fraction: 1 }];
  return {
    version: 1,
    location: { latitude: over.lat, longitude: over.lon },
    ring: null,
    createdAt: at,
    climate: {
      status: 'ok',
      source: 'nasa-power',
      fetchedAt: at,
      data: {
        monthlyRainMm: rain,
        annualRainMm: rain.reduce((a, b) => a + b, 0),
        monthlySolarKwhM2Day: Array(12).fill(5.2),
        annualSolarKwhM2Day: 5.2,
        monthlyTempC: Array(12).fill(27.5),
        annualTempC: 27.5,
        annualTempMaxC: 33,
        annualTempMinC: 22,
        period: '2001–2020',
      },
    },
    rainHistory: { status: 'no-data', source: 'nasa-power', fetchedAt: at, reason: 'test' },
    soil: props.length ? { status: 'ok', source: 'soilgrids', fetchedAt: at, data: { depth: '0–30 cm', properties: props, textureClass: null } } : { status: 'no-data', source: 'soilgrids', fetchedAt: at, reason: 'test' },
    terrain:
      over.elevation === undefined
        ? { status: 'no-data', source: 'aws-terrain', fetchedAt: at, reason: 'test' }
        : { status: 'ok', source: 'aws-terrain', fetchedAt: at, data: { elevationM: over.elevation, slopeDeg: over.slope ?? 1, cellSizeM: 30 } },
    landCover: { status: 'ok', source: 'esa-worldcover', fetchedAt: at, data: { classAtPoint: 40, fractions, samples: 9 } },
  };
}

describe('salt risk', () => {
  it('measures distance to the sea from the bundled outline', () => {
    expect(coastDistanceKm({ latitude: 10.48, longitude: 104.32 })).toBeLessThan(10); // Kep
    expect(coastDistanceKm({ latitude: 11.56, longitude: 104.92 })).toBeGreaterThan(100); // Phnom Penh
  });

  it('gives a sensible reference evapotranspiration', () => {
    // About 4–5 mm a day in a warm, sunny tropical month.
    expect(monthlyEt0(27.5, 5.2, 0) / 31).toBeGreaterThan(3.5);
    expect(monthlyEt0(27.5, 5.2, 0) / 31).toBeLessThan(6);
  });

  it('rates low coastal land as high risk and inland land as low', () => {
    expect(saltRisk(summary({ lat: 10.5, lon: 104.3, elevation: 2 })).level).toBe('high');
    const inland = saltRisk(summary({ lat: 13.1, lon: 103.2, elevation: 15 }));
    expect(inland.reasons).not.toContain('coast-near-low');
    expect(inland.coastKm).toBeGreaterThan(80);
  });

  it('treats mangroves as a sign of salty water', () => {
    expect(saltRisk(summary({ lat: 13.1, lon: 103.2, elevation: 15, mangrove: 0.2 })).reasons).toContain('mangrove');
  });

  it('flags a dry climate', () => {
    const r = saltRisk(summary({ lat: 13.1, lon: 103.2, elevation: 15, rain: Array(12).fill(20) }));
    expect(r.reasons).toContain('arid');
    expect(r.level).not.toBe('low');
  });
});

describe('soil fixes', () => {
  it('finds no problems on good soil inland', () => {
    const plan = soilFixPlan(summary({ lat: 13.1, lon: 103.2, elevation: 15, soil: { phh2o: 6.4, soc: 15, sand: 40, clay: 30, cec: 15, nitrogen: 1.5 } }));
    expect(plan.problems.filter((p) => !p.id.startsWith('salt'))).toEqual([]);
  });

  it('marks very acid, steep land as not suitable and lists the worst first', () => {
    const plan = soilFixPlan(summary({ lat: 13.1, lon: 103.2, elevation: 200, slope: 20, soil: { phh2o: 4.6, soc: 6, sand: 75 } }));
    expect(plan.notSuitable).toBe(true);
    const ids = plan.problems.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['very-acid', 'steep', 'low-organic', 'sandy']));
    expect(plan.problems[0].severity).toBe('blocker');
    expect(plan.problems.find((p) => p.id === 'very-acid')?.crops).toContain('cassava');
  });

  it('adds the salt problem near the sea', () => {
    const plan = soilFixPlan(summary({ lat: 10.5, lon: 104.3, elevation: 2, soil: { phh2o: 6.5 } }));
    expect(plan.problems.map((p) => p.id)).toContain('salt-high');
    expect(plan.notSuitable).toBe(true);
  });
});
