/** A WGS84 coordinate in decimal degrees. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Segment {
  from: LatLng;
  to: LatLng;
  /** Geodesic length on the WGS84 ellipsoid, in metres. */
  lengthMeters: number;
}

export interface ParcelMeasurement {
  /** Geodesic area on the WGS84 ellipsoid, in square metres (always >= 0). */
  areaSquareMeters: number;
  areaHectares: number;
  /** Closed-ring perimeter, in metres. */
  perimeterMeters: number;
  /** One entry per edge, including the closing edge back to the first vertex. */
  segments: Segment[];
  vertexCount: number;
}
