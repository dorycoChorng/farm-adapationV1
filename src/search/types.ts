export type PlaceSource = 'nominatim' | 'country-index' | 'saved' | 'coordinates';

export interface PlaceResult {
  id: string;
  /** Short label, e.g. "Battambang". */
  name: string;
  /** Full context from the provider, e.g. "Battambang, Battambang Province, Cambodia". */
  displayName: string;
  /** Khmer name, when known (countries from the bundled index). */
  nameKm?: string | null;
  latitude: number;
  longitude: number;
  /** [west, south, east, north] when the provider gives an extent. */
  bbox: [number, number, number, number] | null;
  /** Provider's feature class, e.g. "country", "state", "village". */
  kind: string;
  source: PlaceSource;
}
