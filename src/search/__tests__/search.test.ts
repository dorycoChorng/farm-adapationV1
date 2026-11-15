import { cambodia, searchCountries } from '../countries';
import { createGeocoder, GeocoderError, MIN_INTERVAL_MS, parseNominatim } from '../geocoder';

// The response below mimics the shape of a Nominatim jsonv2 reply. It is a test
// fixture, not a recorded answer from the live service.
const FIXTURE = [
  {
    place_id: 101,
    lat: '13.1',
    lon: '103.2',
    name: 'Battambang',
    display_name: 'Battambang, Battambang Province, Cambodia',
    addresstype: 'city',
    boundingbox: ['13.0', '13.2', '103.1', '103.3'],
  },
  { place_id: 102, lat: 'not-a-number', lon: '1', display_name: 'Broken row' },
];

function okResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('parseNominatim', () => {
  it('maps fields, reorders the bounding box and drops invalid rows', () => {
    expect(parseNominatim(FIXTURE)).toEqual([
      {
        id: 'nominatim:101',
        name: 'Battambang',
        displayName: 'Battambang, Battambang Province, Cambodia',
        latitude: 13.1,
        longitude: 103.2,
        bbox: [103.1, 13.0, 103.3, 13.2],
        kind: 'city',
        source: 'nominatim',
      },
    ]);
  });

  it('rejects a non-array body', () => {
    expect(() => parseNominatim({ error: 'x' })).toThrow(GeocoderError);
  });
});

describe('createGeocoder', () => {
  it('sends an identifying User-Agent and encodes the query', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(FIXTURE));
    const search = createGeocoder({ baseUrl: 'https://geo.example/', userAgent: 'FarmTest/1', fetchImpl });
    await search('Siem Reap & co', { language: 'km' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://geo.example/search?format=jsonv2&addressdetails=0&limit=10&q=Siem%20Reap%20%26%20co&accept-language=km',
    );
    expect(init.headers['User-Agent']).toBe('FarmTest/1');
  });

  it('spaces consecutive requests at least one second apart', async () => {
    let t = 0;
    const sleep = jest.fn(async (ms: number) => {
      t += ms;
    });
    const fetchImpl = jest.fn().mockResolvedValue(okResponse([]));
    const search = createGeocoder({ baseUrl: 'https://g', userAgent: 'x', fetchImpl, now: () => t, sleep });
    await search('a');
    t += 200;
    await search('b');
    expect(sleep).toHaveBeenCalledWith(MIN_INTERVAL_MS - 200);
  });

  it.each([
    [() => Promise.reject(new TypeError('Network request failed')), 'network'],
    [() => Promise.resolve(okResponse([], 429)), 'rate-limited'],
    [() => Promise.resolve(okResponse([], 503)), 'http'],
  ])('classifies failures (%#)', async (impl, kind) => {
    const search = createGeocoder({ baseUrl: 'https://g', userAgent: 'x', fetchImpl: jest.fn(impl) });
    await expect(search('x')).rejects.toMatchObject({ kind });
  });

  it('does not call the network for an empty query', async () => {
    const fetchImpl = jest.fn();
    const search = createGeocoder({ baseUrl: 'https://g', userAgent: 'x', fetchImpl });
    expect(await search('   ')).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('offline country index', () => {
  it('finds countries by name, ISO code and the Khmer name for Cambodia', () => {
    expect(searchCountries('camb')[0].name).toBe('Cambodia');
    expect(searchCountries('KHM')[0].name).toBe('Cambodia');
    expect(searchCountries('កម្ពុជា')[0].name).toBe('Cambodia');
    expect(searchCountries('viet')[0].name).toBe('Vietnam');
  });

  it('gives Cambodia an extent from the bundled Natural Earth data', () => {
    const kh = cambodia();
    const [w, s, e, n] = kh.bbox!;
    expect(w).toBeLessThan(kh.longitude);
    expect(e).toBeGreaterThan(kh.longitude);
    expect(s).toBeLessThan(kh.latitude);
    expect(n).toBeGreaterThan(kh.latitude);
  });
});
