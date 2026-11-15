/**
 * Licence checks for crop photos. Only Wikimedia Commons files are used: Commons accepts
 * only free licences (CC BY, CC BY-SA, CC0) and public-domain files, while a picture
 * stored on Wikipedia itself may be a copyrighted "fair use" image.
 */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
/** Commons files live under this path; files under /wikipedia/en/ are local to English Wikipedia. */
const COMMONS_PATH = '//upload.wikimedia.org/wikipedia/commons/';

export const isCommonsUpload = (url: string) => url.includes(COMMONS_PATH);

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

/** Photographer and licence of a Commons file, from its page's metadata. */
export async function loadPhotoCredit(filePage: string, get: typeof fetch = fetch): Promise<PhotoCredit | null> {
  const file = decodeURIComponent(filePage.split('/wiki/')[1] ?? '');
  if (!file) return null;
  const url = `${COMMONS_API}?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(file)}`;
  const res = await get(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    query?: { pages?: Record<string, { imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }> };
  };
  const meta = Object.values(body.query?.pages ?? {})[0]?.imageinfo?.[0]?.extmetadata;
  if (!meta) return null;
  const artist = meta.Artist?.value ? plainText(meta.Artist.value) : '';
  const licence = meta.LicenseShortName?.value ? plainText(meta.LicenseShortName.value) : '';
  return { artist: artist || null, licence: licence || null };
}

