import {
  distanceMeters,
  geodesicMidpoint,
  measureParcel,
  normalizeRing,
  pathLengthMeters,
  segmentsOf,
} from '../geodesy';
import { formatHectares, formatLatLng, parseCoordinatePair } from '../format';
import { isSelfIntersecting, validateParcelRing } from '../polygon';
import type { LatLng } from '../types';

// Reference values in these tests come from closed-form ellipsoid formulas
// computed independently of geographiclib, or from published WGS84 constants.
// The coordinates are synthetic test shapes, not real farm parcels.

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);
const E = Math.sqrt(E2);
const deg = Math.PI / 180;

/** Authalic q(φ): area on the ellipsoid between the equator and latitude φ is (a²Δλ/2)·q(φ). */
function q(phiDeg: number): number {
  const s = Math.sin(phiDeg * deg);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
}

/** Exact area of a cell bounded by two meridians and two parallels. */
function cellArea(lat1: number, lat2: number, dLonDeg: number): number {
  return ((WGS84_A * WGS84_A * dLonDeg * deg) / 2) * Math.abs(q(lat2) - q(lat1));
}

function rectangle(lat: number, lon: number, dLat: number, dLon: number): LatLng[] {
  return [
    { latitude: lat, longitude: lon },
    { latitude: lat, longitude: lon + dLon },
    { latitude: lat + dLat, longitude: lon + dLon },
    { latitude: lat + dLat, longitude: lon },
  ];
}

describe('reference formula sanity check', () => {
  it('reproduces the published WGS84 surface area', () => {
    const total = 2 * cellArea(0, 90, 360);
    expect(total / 1e6).toBeCloseTo(510_065_621.7, 0);
  });
});

describe('distanceMeters', () => {
  it('matches a·Δλ along the equator', () => {
    const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(d).toBeCloseTo(WGS84_A * deg, 4); // 111 319.4908 m
  });

  it('matches the WGS84 meridian arc from 0° to 1°', () => {
    const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeCloseTo(110_574.3886, 2);
  });

  it('is symmetric and zero for identical points', () => {
    const a = { latitude: 12.5, longitude: 104.9 };
    const b = { latitude: 12.51, longitude: 104.93 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 9);
    expect(distanceMeters(a, a)).toBe(0);
  });

  it('handles the antimeridian by taking the short way round', () => {
    const d = distanceMeters({ latitude: 0, longitude: 179.9995 }, { latitude: 0, longitude: -179.9995 });
    expect(d).toBeCloseTo(WGS84_A * deg * 0.001, 3);
  });
});

describe('measureParcel area', () => {
  it.each([
    ['small field near the equator', 0.5, 30.0, 0.001, 0.001],
    ['field at 11.5°N', 11.5, 104.9, 0.0009, 0.0012],
    ['field at 45°S', -45, 170, 0.002, 0.003],
    ['field at 60°N', 60, 10, 0.001, 0.002],
  ])('matches the closed-form cell area for a %s', (_label, lat, lon, dLat, dLon) => {
    const expected = cellArea(lat, lat + dLat, dLon);
    const { areaSquareMeters } = measureParcel(rectangle(lat, lon, dLat, dLon));
    // Geodesic top/bottom edges bulge from the parallels by millimetres at this size.
    expect(Math.abs(areaSquareMeters - expected) / expected).toBeLessThan(1e-5);
  });

  it('gives the same positive area for clockwise and counter-clockwise rings', () => {
    const ccw = rectangle(11.5, 104.9, 0.001, 0.001);
    const cw = [...ccw].reverse();
    const a = measureParcel(ccw).areaSquareMeters;
    const b = measureParcel(cw).areaSquareMeters;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a, 6);
  });

  it('converts square metres to hectares', () => {
    const m = measureParcel(rectangle(11.5, 104.9, 0.001, 0.001));
    expect(m.areaHectares).toBeCloseTo(m.areaSquareMeters / 10_000, 12);
  });

  it('measures a triangle as half the matching rectangle (to within curvature error)', () => {
    const r = rectangle(11.5, 104.9, 0.001, 0.001);
    const tri = [r[0], r[1], r[2]];
    const ratio = measureParcel(tri).areaSquareMeters / measureParcel(r).areaSquareMeters;
    expect(ratio).toBeCloseTo(0.5, 3);
  });

  it('ignores an explicit closing vertex and duplicate taps', () => {
    const r = rectangle(11.5, 104.9, 0.001, 0.001);
    const withDupes = [r[0], r[0], r[1], r[2], r[2], r[3], r[0]];
    const a = measureParcel(r);
    const b = measureParcel(withDupes);
    expect(b.vertexCount).toBe(4);
    expect(b.areaSquareMeters).toBeCloseTo(a.areaSquareMeters, 6);
    expect(b.perimeterMeters).toBeCloseTo(a.perimeterMeters, 6);
  });

  it('handles a parcel that straddles the antimeridian', () => {
    const across: LatLng[] = [
      { latitude: -16.0, longitude: 179.9995 },
      { latitude: -16.0, longitude: -179.9995 },
      { latitude: -15.999, longitude: -179.9995 },
      { latitude: -15.999, longitude: 179.9995 },
    ];
    const expected = cellArea(-16, -15.999, 0.001);
    const { areaSquareMeters } = measureParcel(across);
    expect(Math.abs(areaSquareMeters - expected) / expected).toBeLessThan(1e-5);
  });

  it('returns zero area for fewer than three distinct points', () => {
    expect(measureParcel([]).areaSquareMeters).toBe(0);
    const two = measureParcel([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    ]);
    expect(two.areaSquareMeters).toBe(0);
    expect(two.vertexCount).toBe(2);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() =>
      measureParcel([
        { latitude: 0, longitude: 0 },
        { latitude: 91, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('perimeter and segments', () => {
  it('sums the closed ring including the closing edge', () => {
    const r = rectangle(11.5, 104.9, 0.001, 0.002);
    const m = measureParcel(r);
    expect(m.segments).toHaveLength(4);
    const sum = m.segments.reduce((s, seg) => s + seg.lengthMeters, 0);
    expect(m.perimeterMeters).toBeCloseTo(sum, 6);
    // The closing edge runs from the last vertex back to the first.
    expect(m.segments[3].from).toEqual(r[3]);
    expect(m.segments[3].to).toEqual(r[0]);
  });

  it('matches the meridian and parallel edge lengths of a rectangle', () => {
    const lat = 11.5;
    const m = measureParcel(rectangle(lat, 104.9, 0.001, 0.002));
    // East-west edge on the parallel: N(φ)·cosφ·Δλ (geodesic differs by < 1 µm here).
    const s = Math.sin(lat * deg);
    const n = WGS84_A / Math.sqrt(1 - E2 * s * s);
    expect(m.segments[0].lengthMeters).toBeCloseTo(n * Math.cos(lat * deg) * 0.002 * deg, 3);
  });

  it('lists open-path segments without a closing edge', () => {
    const r = rectangle(11.5, 104.9, 0.001, 0.001);
    expect(segmentsOf(r, false)).toHaveLength(3);
    expect(pathLengthMeters(r)).toBeLessThan(measureParcel(r).perimeterMeters);
  });
});

describe('geodesicMidpoint', () => {
  it('is equidistant from both ends', () => {
    const a = { latitude: 11.5, longitude: 104.9 };
    const b = { latitude: 11.52, longitude: 104.95 };
    const mid = geodesicMidpoint(a, b);
    expect(distanceMeters(a, mid)).toBeCloseTo(distanceMeters(mid, b), 6);
  });
});

describe('normalizeRing', () => {
  it('drops consecutive duplicates and the closing vertex', () => {
    const p = { latitude: 1, longitude: 1 };
    const q2 = { latitude: 1, longitude: 2 };
    const r = { latitude: 2, longitude: 2 };
    expect(normalizeRing([p, p, q2, r, p])).toEqual([p, q2, r]);
  });
});

describe('polygon validation', () => {
  it('flags a bow-tie as self-intersecting', () => {
    const bowtie: LatLng[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0.001 },
      { latitude: 0, longitude: 0.001 },
      { latitude: 0.001, longitude: 0 },
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    expect(validateParcelRing(bowtie)).toEqual(['self-intersecting']);
  });

  it('accepts a simple concave polygon', () => {
    const l: LatLng[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.002 },
      { latitude: 0.001, longitude: 0.002 },
      { latitude: 0.001, longitude: 0.001 },
      { latitude: 0.002, longitude: 0.001 },
      { latitude: 0.002, longitude: 0 },
    ];
    expect(isSelfIntersecting(l)).toBe(false);
    expect(validateParcelRing(l)).toEqual([]);
  });

  it('requires three distinct vertices', () => {
    expect(validateParcelRing([{ latitude: 0, longitude: 0 }])).toEqual(['too-few-points']);
  });

  it('does not report a false crossing across the antimeridian', () => {
    const across: LatLng[] = [
      { latitude: -16.0, longitude: 179.9995 },
      { latitude: -16.0, longitude: -179.9995 },
      { latitude: -15.999, longitude: -179.9995 },
      { latitude: -15.999, longitude: 179.9995 },
    ];
    expect(isSelfIntersecting(across)).toBe(false);
  });
});

describe('formatting and parsing', () => {
  it('formats hemispheres', () => {
    expect(formatLatLng({ latitude: -1.5, longitude: -70.25 }, 2)).toBe('1.50° S, 70.25° W');
  });

  it('formats hectares with sensible precision', () => {
    expect(formatHectares(1.23456)).toBe('1.235 ha');
    expect(formatHectares(12.3456)).toBe('12.35 ha');
    expect(formatHectares(2_610_096.012)).toBe('2,610,096.01 ha');
  });

  it('parses typed coordinate pairs and rejects invalid ones', () => {
    expect(parseCoordinatePair('11.5, 104.9')).toEqual({ latitude: 11.5, longitude: 104.9 });
    expect(parseCoordinatePair('-33.9 18.4')).toEqual({ latitude: -33.9, longitude: 18.4 });
    expect(parseCoordinatePair('95, 10')).toBeNull();
    expect(parseCoordinatePair('Battambang')).toBeNull();
  });
});
