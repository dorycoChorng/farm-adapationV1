import { normalizeRing } from './geodesy';
import type { LatLng } from './types';

export type RingProblem = 'too-few-points' | 'self-intersecting';

interface XY {
  x: number;
  y: number;
}

/**
 * Projects a ring onto a local equirectangular plane centred on the ring.
 * Longitudes are unwrapped relative to the first vertex so parcels that
 * straddle the antimeridian stay contiguous. Only used for topology tests,
 * never for measurements.
 */
function toLocalPlane(ring: readonly LatLng[]): XY[] {
  const lon0 = ring[0].longitude;
  const unwrapped = ring.map((p) => {
    let d = p.longitude - lon0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return { lat: p.latitude, lon: lon0 + d };
  });
  const meanLat = unwrapped.reduce((s, p) => s + p.lat, 0) / unwrapped.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  return unwrapped.map((p) => ({ x: p.lon * k, y: p.lat }));
}

function orientation(a: XY, b: XY, c: XY): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const eps = 1e-15;
  return v > eps ? 1 : v < -eps ? -1 : 0;
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(p1: XY, p2: XY, q1: XY, q2: XY): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

/** True when any two non-adjacent edges of the closed ring cross or touch. */
export function isSelfIntersecting(points: readonly LatLng[]): boolean {
  const ring = normalizeRing(points);
  const n = ring.length;
  if (n < 4) return false;
  const xy = toLocalPlane(ring);
  for (let i = 0; i < n; i++) {
    const a1 = xy[i];
    const a2 = xy[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex with edge i.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(a1, a2, xy[j], xy[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Problems that stop a boundary from being saved as a parcel, in priority order. */
export function validateParcelRing(points: readonly LatLng[]): RingProblem[] {
  const ring = normalizeRing(points);
  const problems: RingProblem[] = [];
  if (ring.length < 3) problems.push('too-few-points');
  else if (isSelfIntersecting(ring)) problems.push('self-intersecting');
  return problems;
}
