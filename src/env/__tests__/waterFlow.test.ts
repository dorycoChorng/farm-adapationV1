import { flowLevel, flowModel, nasademTileName, POND_M, waterFlowMap } from '../waterFlow';

/** A valley sloping south, with sides rising east and west, and a 3 m pit in the middle. */
function valley(cols = 9, rows = 9) {
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = Math.abs(c - 4) * 2 + (rows - r);
  z[4 * cols + 4] -= 3;
  return { cols, rows, z };
}

describe('water flow', () => {
  it('names NASADEM tiles by their south-west corner', () => {
    expect(nasademTileName(11.55, 104.92)).toBe('NASADEM_HGT_n11e104.tif');
    expect(nasademTileName(-0.5, -60.2)).toBe('NASADEM_HGT_s01w061.tif');
  });

  it('sends all the water down the valley and finds the pit', () => {
    const g = valley();
    const { acc, pondDepth, down } = flowModel(g, 30, 30);
    // Everything ends up at the bottom of the valley floor.
    expect(acc[8 * 9 + 4]).toBe(81);
    // The valley floor collects far more than its sides.
    expect(acc[6 * 9 + 4]).toBeGreaterThan(acc[6 * 9 + 2] * 5);
    // The pit fills before it overflows, and still drains on.
    expect(pondDepth[4 * 9 + 4]).toBeGreaterThanOrEqual(POND_M);
    expect(down[4 * 9 + 4]).toBeGreaterThanOrEqual(0);
  });

  it('lets water leave where there is no data', () => {
    const g = valley();
    g.z[8 * 9 + 4] = NaN;
    const { acc } = flowModel(g, 30, 30);
    expect(acc[7 * 9 + 4]).toBeGreaterThan(40);
  });

  it('grades shading by the land draining through a cell', () => {
    expect(flowLevel(1000)).toBe(0);
    expect(flowLevel(5000)).toBe(1);
    expect(flowLevel(20_000)).toBe(2);
    expect(flowLevel(100_000)).toBe(3);
    expect(flowLevel(500_000)).toBe(4);
  });

  it('shades only cells inside the land', () => {
    const { cols, rows, z } = valley();
    const s = 1 / 3600;
    const lonEdges = Array.from({ length: cols + 1 }, (_, i) => 104 + i * s);
    const latEdges = Array.from({ length: rows + 1 }, (_, i) => 11.5 - i * s);
    const land: [number, number, number, number] = [104 + 2 * s, 11.5 - 7 * s, 104 + 7 * s, 11.5 - 2 * s];
    const map = waterFlowMap({ cols, rows, lonEdges, latEdges, z, source: 'nasadem' }, land, null);
    expect(map.cells.length).toBeGreaterThan(0);
    for (const c of map.cells) {
      const lon = (c.ring[0][0] + c.ring[1][0]) / 2;
      const lat = (c.ring[0][1] + c.ring[2][1]) / 2;
      expect(lon).toBeGreaterThanOrEqual(land[0]);
      expect(lon).toBeLessThanOrEqual(land[2]);
      expect(lat).toBeGreaterThanOrEqual(land[1]);
      expect(lat).toBeLessThanOrEqual(land[3]);
    }
    expect(map.pondShare).toBeGreaterThan(0);
  });
});
