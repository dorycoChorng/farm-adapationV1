import { BLOCK_DEG, blocksFor, MAX_BLOCKS, parseRegional, regionalUrl } from '../climateGrid';

describe('NASA POWER rainfall and sunlight grid', () => {
  it('asks POWER for one parameter over one 4° block', () => {
    const url = regionalUrl('rainfall', 104, 8);
    expect(url).toContain('/climatology/regional?');
    expect(url).toContain('latitude-min=8');
    expect(url).toContain('latitude-max=12');
    expect(url).toContain('parameters=PRECTOTCORR');
  });

  it('covers the view with 4° blocks, nearest the middle first', () => {
    const blocks = blocksFor([102.5, 10.5, 107.5, 14.5]);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual([104, 12]);
  });

  it('still loads the middle of a very wide view', () => {
    const blocks = blocksFor([60, -10, 150, 40]);
    expect(blocks).toHaveLength(MAX_BLOCKS);
    // The block holding the centre (105°E, 15°N) comes first.
    expect(blocks[0]).toEqual([104, 12]);
    expect(BLOCK_DEG).toBe(4);
  });

  it('reads GeoJSON answers and turns mm/day into mm/year', () => {
    const cells = parseRegional(
      {
        features: [
          { geometry: { coordinates: [104.375, 11.0, 10] }, properties: { parameter: { PRECTOTCORR: { ANN: 4 } } } },
          { geometry: { coordinates: [105.0, 11.0, 10] }, properties: { parameter: { PRECTOTCORR: { ANN: -999 } } } },
        ],
      },
      'rainfall',
    );
    expect(cells).toEqual([{ w: 104.0625, e: 104.6875, s: 10.75, n: 11.25, v: 1461 }]);
  });

  it('reads CSV answers', () => {
    const csv = [
      '-BEGIN HEADER-',
      'NASA/POWER climatology',
      '-END HEADER-',
      'PARAMETER,LAT,LON,JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC,ANN',
      'ALLSKY_SFC_SW_DWN,11.0,104.375,5,5,6,6,5,4,4,4,4,4,5,5,4.83',
    ].join('\n');
    expect(parseRegional(csv, 'sunlight')).toEqual([{ w: 104.0625, e: 104.6875, s: 10.75, n: 11.25, v: 4.83 }]);
  });
});
