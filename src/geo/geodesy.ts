import { Geodesic } from 'geographiclib-geodesic';

import type { LatLng, ParcelMeasurement, Segment } from './types';

// Karney's algorithms on the WGS84 ellipsoid (the datum GPS reports in).
// Accurate to nanometres for distance and to well under a square metre for
// parcel-sized areas, so no map projection is needed.
const WGS84 = Geodesic.WGS84;

export const SQUARE_METERS_PER_HECTARE = 10_000;

export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180
  );
}

/** Geodesic distance between two points, in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const r = WGS84.Inverse(a.latitude, a.longitude, b.latitude, b.longitude, Geodesic.DISTANCE);
  return r.s12 ?? 0;
}

/** Drops consecutive duplicates and a repeated closing vertex, so callers may pass open or closed rings. */
export function normalizeRing(points: readonly LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.latitude !== p.latitude || prev.longitude !== p.longitude) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first.latitude === last.latitude && first.longitude === last.longitude) out.pop();
  }
  return out;
}

/** Edges between consecutive points; when `closed`, also the edge from the last point back to the first. */
export function segmentsOf(points: readonly LatLng[], closed: boolean): Segment[] {
  const ring = normalizeRing(points);
  const segments: Segment[] = [];
  const edgeCount = closed && ring.length >= 3 ? ring.length : ring.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const from = ring[i];
    const to = ring[(i + 1) % ring.length];
    segments.push({ from, to, lengthMeters: distanceMeters(from, to) });
  }
  return segments;
}

/** Length of an open polyline, in metres. */
export function pathLengthMeters(points: readonly LatLng[]): number {
  return segmentsOf(points, false).reduce((sum, s) => sum + s.lengthMeters, 0);
}

/**
 * Area, perimeter and edge lengths of a closed parcel boundary.
 * Vertex order (clockwise or counter-clockwise) does not matter.
 * Fewer than three distinct vertices yields zero area.
 */
export function measureParcel(points: readonly LatLng[]): ParcelMeasurement {
  const ring = normalizeRing(points);
  for (const p of ring) {
    if (!isValidLatLng(p)) throw new RangeError(`Invalid coordinate: ${p.latitude}, ${p.longitude}`);
  }
  const segments = segmentsOf(ring, true);
  if (ring.length < 3) {
    return {
      areaSquareMeters: 0,
      areaHectares: 0,
      perimeterMeters: segments.reduce((sum, s) => sum + s.lengthMeters, 0),
      segments,
      vertexCount: ring.length,
    };
  }

  const polygon = WGS84.Polygon(false);
  for (const p of ring) polygon.AddPoint(p.latitude, p.longitude);
  // reverse=false, sign=true gives a signed area whose sign depends on winding;
  // the magnitude is what a farmer cares about.
  const result = polygon.Compute(false, true);
  const area = Math.abs(result.area ?? 0);

  return {
    areaSquareMeters: area,
    areaHectares: area / SQUARE_METERS_PER_HECTARE,
    perimeterMeters: result.perimeter,
    segments,
    vertexCount: ring.length,
  };
}

/** Midpoint along the geodesic between two points (used to place edge-length labels). */
export function geodesicMidpoint(a: LatLng, b: LatLng): LatLng {
  const line = WGS84.InverseLine(a.latitude, a.longitude, b.latitude, b.longitude);
  const mid = line.Position(line.s13 / 2);
  return { latitude: mid.lat2 ?? a.latitude, longitude: mid.lon2 ?? a.longitude };
}
