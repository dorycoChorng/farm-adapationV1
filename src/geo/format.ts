import type { LatLng } from './types';

export function formatCoordinate(value: number, positive: string, negative: string, digits = 6): string {
  return `${Math.abs(value).toFixed(digits)}° ${value >= 0 ? positive : negative}`;
}

export function formatLatLng(p: LatLng, digits = 6): string {
  return `${formatCoordinate(p.latitude, 'N', 'S', digits)}, ${formatCoordinate(p.longitude, 'E', 'W', digits)}`;
}

/** Decimal pair as typed into other tools, e.g. "11.556400, 104.928200". */
export function formatDecimalPair(p: LatLng, digits = 6): string {
  return `${p.latitude.toFixed(digits)}, ${p.longitude.toFixed(digits)}`;
}

export function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  if (m >= 100) return `${m.toFixed(0)} m`;
  return `${m.toFixed(1)} m`;
}

export function formatSquareMeters(m2: number): string {
  return `${Math.round(m2).toLocaleString('en-US')} m²`;
}

export function formatHectares(ha: number): string {
  const digits = ha < 10 ? 3 : 2;
  return `${ha.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ha`;
}

/**
 * Parses a typed coordinate pair such as "11.55, 104.92" or "11.55 104.92".
 * Returns null when the text is not a valid latitude/longitude pair.
 */
export function parseCoordinatePair(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}
