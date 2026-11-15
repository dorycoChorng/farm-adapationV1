/**
 * Plant identification for the app's "Scan a plant" screen (Vercel function: POST /api/identify).
 *
 * The app sends one photo; this forwards it to the Pl@ntNet identification API with the
 * key held in the PLANTNET_API_KEY environment variable, so the key never ships in the
 * app. Photos are passed straight through and are not stored or logged here.
 * API reference: https://my.plantnet.org/doc/api/identify
 */

export const PLANTNET_URL = 'https://my-api.plantnet.org/v2/identify/all';
const ORGANS = new Set(['leaf', 'flower', 'fruit', 'bark', 'auto']);
const TYPES = new Set(['image/jpeg', 'image/png']);
/** Phone photos are resized by the app; anything bigger than this is refused. */
export const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RESULTS = 5;

export interface Match {
  scientific: string;
  genus: string | null;
  family: string | null;
  commonNames: string[];
  /** 0–1, Pl@ntNet's confidence. */
  score: number;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface PlantNetResult {
  score?: number;
  species?: {
    scientificNameWithoutAuthor?: string;
    genus?: { scientificNameWithoutAuthor?: string };
    family?: { scientificNameWithoutAuthor?: string };
    commonNames?: string[];
  };
}

/** The part of the Fetch API's FormData used here (the app's React Native typings declare a different FormData). */
interface IncomingForm {
  get(name: string): File | string | null;
}

/** The handler, with the key and fetch passed in so it can be tested without the network. */
export async function identify(request: Request, apiKey: string | undefined, send: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  if (!apiKey) return json(503, { error: 'not-configured' });
  let form: IncomingForm;
  try {
    form = (await request.formData()) as unknown as IncomingForm;
  } catch {
    return json(400, { error: 'bad-request' });
  }
  const image = form.get('image');
  if (!image || typeof image === 'string') return json(400, { error: 'no-image' });
  if (!TYPES.has(image.type)) return json(415, { error: 'type' });
  if (image.size > MAX_BYTES) return json(413, { error: 'too-large' });
  const organ = String(form.get('organ') ?? 'auto');
  const lang = form.get('lang') === 'km' ? 'km' : 'en';

  const out = new FormData();
  out.append('images', image, image.name || 'plant.jpg');
  out.append('organs', ORGANS.has(organ) ? organ : 'auto');
  const url = `${PLANTNET_URL}?${new URLSearchParams({ 'api-key': apiKey, lang, 'nb-results': String(MAX_RESULTS) })}`;
  let res: Response;
  try {
    res = await send(url, { method: 'POST', body: out });
  } catch {
    return json(502, { error: 'upstream' });
  }
  // Pl@ntNet answers 404 when no species reaches its minimum confidence.
  if (res.status === 404) return json(200, { matches: [] });
  if (res.status === 401 || res.status === 403) return json(503, { error: 'not-configured' });
  if (res.status === 429) return json(429, { error: 'quota' });
  if (!res.ok) return json(502, { error: 'upstream', status: res.status });
  const body = (await res.json()) as { results?: PlantNetResult[] };
  const matches: Match[] = (body.results ?? [])
    .filter((r) => r.species?.scientificNameWithoutAuthor)
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      scientific: r.species!.scientificNameWithoutAuthor!,
      genus: r.species!.genus?.scientificNameWithoutAuthor ?? null,
      family: r.species!.family?.scientificNameWithoutAuthor ?? null,
      commonNames: (r.species!.commonNames ?? []).slice(0, 4),
      score: Number((r.score ?? 0).toFixed(3)),
    }));
  return json(200, { matches });
}

export function POST(request: Request) {
  return identify(request, process.env.PLANTNET_API_KEY);
}
