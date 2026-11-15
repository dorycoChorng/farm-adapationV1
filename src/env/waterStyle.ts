/**
 * The three kinds of water path a farmer sees, plus spots where water collects. The map
 * page (src/map/web/map-app.js) and the legends use these same colours and widths.
 */
export type WaterPathKind = 'small' | 'stream' | 'main';

export const WATER_STYLE = {
  small: { color: '#4fc3f7', width: 2 },
  stream: { color: '#1e88e5', width: 3.5 },
  main: { color: '#0d47a1', width: 5.5 },
  pond: { color: '#8e5cd9' },
} as const;

/** Flow level 4 (20 ha or more draining in) is a main water path and level 3 a stream; smaller levels are run-off. */
export const pathKind = (level: number): WaterPathKind => (level >= 4 ? 'main' : level === 3 ? 'stream' : 'small');
