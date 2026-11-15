import { BLOCK_DEG, blocksFor, MAX_BLOCKS, parseRegional, regionalUrl } from '../climateGrid';

describe('NASA POWER rainfall and sunlight grid', () => {
  it('asks POWER for one parameter over one 4° block', () => {
    const url = regionalUrl('rainfall', 104, 8);
    expect(url).toContain('/climatology/regional?');
    expect(url).toContain('latitude-min=8');
    expect(url).toContain('latitude-max=12');
    expect(url).toContain('parameters=PRECTOTCORR');
  });

  it('covers the view with 4° blocks and gives up when zoomed far out', () => {
    expect(blocksFor([102.5, 10.5, 107.5, 14.5])).toEqual([
      [100, 8],
      [104, 8],
      [100, 12],
      [104, 12],
    ]);
    expect(blocksFor([-180, -80, 180, 80])).toEqual([]);
    expect(MAX_BLOCKS * BLOCK_DEG).toBeGreaterThan(20);
  });

  it('reads GeoJSON answers and turns mm/day into mm/year', () => {
    const cells = parseRegional(
      {
        features: [
          { geometry: { coordinates: [104.75, 11.25, 10] }, properties: { parameter: { PRECTOTCORR: { ANN: 4 } } } },
          { geometry: { coordinates: [105.25, 11.25, 10] }, properties: { parameter: { PRECTOTCORR: { ANN: -999 } } } },
        ],
      },
      'rainfall',
    );
    expect(cells).toEqual([{ w: 104.5, e: 105, s: 11, n: 11.5, v: 1461 }]);
  });

  it('reads CSV answers', () => {
    const csv = [
      '-BEGIN HEADER-',
      'NASA/POWER climatology',
      '-END HEADER-',
      'PARAMETER,LAT,LON,JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC,ANN',
      'ALLSKY_SFC_SW_DWN,11.25,104.75,5,5,6,6,5,4,4,4,4,4,5,5,4.83',
    ].join('\n');
    expect(parseRegional(csv, 'sunlight')).toEqual([{ w: 104.5, e: 105, s: 11, n: 11.5, v: 4.83 }]);
  });
});
