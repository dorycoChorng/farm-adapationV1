/**
 * Plant identification. Pl@ntNet can't be reached from the test machine, so its answers
 * here are SYNTHETIC, shaped like the documented response
 * (https://my.plantnet.org/doc/api/identify); they are not real identifications.
 */
import { identify, MAX_BYTES, PLANTNET_URL } from '../../../api/identify';
import { catalogueCrop, identifyPlant } from '../identify';

const photo = (type = 'image/jpeg', size = 1000) => new File([new Uint8Array(size)], 'leaf.jpg', { type });
const upload = (file: File | null, organ = 'leaf') => {
  const form = new FormData();
  if (file) form.append('image', file);
  form.append('organ', organ);
  return new Request('https://app.example/api/identify', { method: 'POST', body: form });
};
const plantnet = (status: number, body: unknown = {}) => jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const SYNTHETIC = {
  bestMatch: 'Oryza sativa L.',
  results: [
    {
      score: 0.81,
      species: {
        scientificNameWithoutAuthor: 'Oryza sativa',
        genus: { scientificNameWithoutAuthor: 'Oryza' },
        family: { scientificNameWithoutAuthor: 'Poaceae' },
        commonNames: ['Rice', 'Asian rice'],
      },
    },
    { score: 0.05, species: { scientificNameWithoutAuthor: 'Echinochloa crus-galli', commonNames: [] } },
  ],
};

describe('identify function (server)', () => {
  it('refuses without a key, so the app can say it is not set up', async () => {
    const res = await identify(upload(photo()), undefined, plantnet(200));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not-configured' });
  });

  it('checks method, image presence, type and size before calling Pl@ntNet', async () => {
    const send = plantnet(200, SYNTHETIC);
    expect((await identify(new Request('https://x/api/identify'), 'k', send)).status).toBe(405);
    expect((await identify(upload(null), 'k', send)).status).toBe(400);
    expect((await identify(upload(photo('image/gif')), 'k', send)).status).toBe(415);
    expect((await identify(upload(photo('image/jpeg', MAX_BYTES + 1)), 'k', send)).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards the photo with the key and returns trimmed matches', async () => {
    const send = plantnet(200, SYNTHETIC);
    const res = await identify(upload(photo(), 'fruit'), 'secret', send);
    expect(res.status).toBe(200);
    const [url, init] = (send as jest.Mock).mock.calls[0];
    expect(url.startsWith(`${PLANTNET_URL}?`)).toBe(true);
    expect(new URL(url).searchParams.get('api-key')).toBe('secret');
    const sent = init.body as FormData;
    expect(sent.get('organs')).toBe('fruit');
    expect((sent.get('images') as File).size).toBe(1000);
    const body = await res.json();
    expect(body.matches[0]).toEqual({ scientific: 'Oryza sativa', genus: 'Oryza', family: 'Poaceae', commonNames: ['Rice', 'Asian rice'], score: 0.81 });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps Pl@ntNet failures', async () => {
    expect(await (await identify(upload(photo()), 'k', plantnet(404))).json()).toEqual({ matches: [] });
    expect((await identify(upload(photo()), 'k', plantnet(429))).status).toBe(429);
    expect(await (await identify(upload(photo()), 'k', plantnet(401))).json()).toEqual({ error: 'not-configured' });
    expect((await identify(upload(photo()), 'k', plantnet(500))).status).toBe(502);
  });
});

describe('identifyPlant (app)', () => {
  const asSend = (handler: (req: Request) => Promise<Response>) =>
    (async (url: string, init: RequestInit) => handler(new Request(new URL(url, 'https://app.example'), init))) as unknown as typeof fetch;

  it('is not configured without a server URL', async () => {
    expect(await identifyPlant({ uri: 'x', file: photo() }, 'leaf', 'en', null)).toEqual({ status: 'not-configured' });
  });

  it('round-trips through the server function', async () => {
    const send = asSend((req) => identify(req, 'k', plantnet(200, SYNTHETIC)));
    const r = await identifyPlant({ uri: 'blob:x', file: photo(), mimeType: 'image/jpeg' }, 'leaf', 'en', '/api/identify', send);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.matches.map((m) => m.scientific)).toEqual(['Oryza sativa', 'Echinochloa crus-galli']);
  });

  it('reports offline, quota and missing key', async () => {
    const down = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await identifyPlant({ uri: 'x', file: photo() }, 'leaf', 'en', '/api/identify', down)).toEqual({ status: 'offline' });
    const quota = asSend((req) => identify(req, 'k', plantnet(429)));
    expect(await identifyPlant({ uri: 'x', file: photo() }, 'leaf', 'en', '/api/identify', quota)).toEqual({ status: 'error', reason: 'quota' });
    const nokey = asSend((req) => identify(req, undefined));
    expect(await identifyPlant({ uri: 'x', file: photo() }, 'leaf', 'en', '/api/identify', nokey)).toEqual({ status: 'not-configured' });
  });

  it('links identified species to the crop catalogue', () => {
    expect(catalogueCrop({ scientific: 'Oryza sativa' })?.id).toBe('rice');
    expect(catalogueCrop({ scientific: 'Mangifera indica' })?.id).toBe('mango');
    expect(catalogueCrop({ scientific: 'Quercus robur' })).toBeNull();
  });
});
