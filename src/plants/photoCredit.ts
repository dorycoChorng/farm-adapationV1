/**
 * Licence checks for crop photos. Only Wikimedia Commons files are used: Commons accepts
 * only free licences (CC BY, CC BY-SA, CC0) and public-domain files, while a picture
 * stored on Wikipedia itself may be a copyrighted "fair use" image.
 */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
/**
 * A Commons file: served from a wikimedia.org host (upload.wikimedia.org for originals;
 * Wikipedia's summaries now give thumbnails from another wikimedia.org host) under
 * /wikipedia/commons/. Files under /wikipedia/en/ are local to English Wikipedia.
 */
export function isCommonsUpload(url: string): boolean {
  try {
    const u = new URL(url);
    const wikimedia = u.hostname === 'wikimedia.org' || u.hostname.endsWith('.wikimedia.org');
    return u.protocol === 'https:' && wikimedia && u.pathname.startsWith('/wikipedia/commons/');
  } catch {
    return false;
  }
}

export interface PhotoCredit {
  artist: string | null;
  licence: string | null;
}

/** HTML from Commons' metadata as plain text: tags removed, common entities decoded. */
export const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type CommonsPages = {
  query?: {
    normalized?: { from: string; to: string }[];
    pages?: Record<string, { title?: string; imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }>;
  };
};

/** Commons answers up to 50 titles in one request. */
const BATCH = 50;

/** File title ("File:Rice field.jpg") from a Commons file page URL. */
export const fileTitle = (filePage: string) => decodeURIComponent(filePage.split('/wiki/')[1] ?? '').replace(/_/g, ' ');

/** Photographer and licence for many Commons files in one request per 50 files, keyed by file page URL. */
export async function loadPhotoCredits(filePages: string[], get: typeof fetch = fetch): Promise<Map<string, PhotoCredit | null>> {
  const out = new Map<string, PhotoCredit | null>();
  for (let i = 0; i < filePages.length; i += BATCH) {
    const pages = filePages.slice(i, i + BATCH);
    const titles = pages.map(fileTitle);
    const url = `${COMMONS_API}?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(titles.join('|'))}`;
    const res = await get(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as CommonsPages;
    // Commons may rename a title (e.g. a lowercase first letter); follow it back.
    const renamed = new Map((body.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const byTitle = new Map(Object.values(body.query?.pages ?? {}).map((p) => [p.title ?? '', p.imageinfo?.[0]?.extmetadata]));
    pages.forEach((page, k) => {
      const meta = byTitle.get(renamed.get(titles[k]) ?? titles[k]);
      const artist = meta?.Artist?.value ? plainText(meta.Artist.value) : '';
      const licence = meta?.LicenseShortName?.value ? plainText(meta.LicenseShortName.value) : '';
      out.set(page, artist || licence ? { artist: artist || null, licence: licence || null } : null);
    });
  }
  return out;
}

const creditCache = new Map<string, Promise<PhotoCredit | null>>();
let pending: { page: string; resolve: (c: PhotoCredit | null) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const batch = pending;
  pending = [];
  loadPhotoCredits(
    batch.map((b) => b.page),
    fetch,
  ).then(
    (credits) => batch.forEach((b) => b.resolve(credits.get(b.page) ?? null)),
    () =>
      batch.forEach((b) => {
        // Offline or blocked: try again next time the photo is shown.
        creditCache.delete(b.page);
        b.resolve(null);
      }),
  );
}

/**
 * Photographer and licence of a Commons file, cached. Requests made in the same moment
 * (a list of crops appearing) are sent to Commons together.
 */
export function photoCredit(filePage: string): Promise<PhotoCredit | null> {
  let p = creditCache.get(filePage);
  if (!p) {
    p = new Promise((resolve) => {
      pending.push({ page: filePage, resolve });
      if (!flushTimer) flushTimer = setTimeout(flush, 50);
    });
    creditCache.set(filePage, p);
  }
  return p;
}

/** Short credit for small photos: "Jo Smith, CC BY-SA 4.0". */
export const shortCredit = (c: PhotoCredit) => [c.artist, c.licence].filter(Boolean).join(', ');
