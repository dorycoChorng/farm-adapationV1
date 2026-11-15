import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { Match } from '../../api/identify';
import { type CropProfile, CROPS } from '../env/crops';

export type { Match };
export type Organ = 'leaf' | 'flower' | 'fruit' | 'auto';

/**
 * Where the app sends photos to be identified: this project's own /api/identify function
 * (api/identify.ts), which holds the Pl@ntNet key. The web build calls it on its own
 * origin; native builds need `expo.extra.plantIdUrl` set to the deployed URL.
 */
export function plantIdUrl(): string | null {
  const configured = (Constants.expoConfig?.extra as { plantIdUrl?: string | null } | undefined)?.plantIdUrl;
  if (configured) return configured;
  return Platform.OS === 'web' ? '/api/identify' : null;
}

export type IdentifyResult =
  | { status: 'ok'; matches: Match[] }
  | { status: 'not-configured' }
  | { status: 'offline' }
  | { status: 'error'; reason: string };

export interface Photo {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  /** Web only: the picked File. */
  file?: Blob | null;
}

/** Sends one photo for identification. Nothing is sent until the user asks for it. */
export async function identifyPlant(
  photo: Photo,
  organ: Organ,
  language: 'en' | 'km',
  url = plantIdUrl(),
  send: typeof fetch = fetch,
): Promise<IdentifyResult> {
  if (!url) return { status: 'not-configured' };
  const form = new FormData();
  const type = photo.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const name = photo.fileName || (type === 'image/png' ? 'plant.png' : 'plant.jpg');
  if (photo.file) form.append('image', photo.file, name);
  // React Native's FormData takes a file reference object instead of a Blob.
  else form.append('image', { uri: photo.uri, type, name } as unknown as Blob);
  form.append('organ', organ);
  form.append('lang', language);
  let res: Response;
  try {
    res = await send(url, { method: 'POST', body: form });
  } catch {
    return { status: 'offline' };
  }
  const body = (await res.json().catch(() => ({}))) as { matches?: Match[]; error?: string };
  if (res.status === 503 && body.error === 'not-configured') return { status: 'not-configured' };
  if (!res.ok) return { status: 'error', reason: body.error ?? `HTTP ${res.status}` };
  return { status: 'ok', matches: body.matches ?? [] };
}

/** Below this Pl@ntNet score a match is shown as uncertain. */
export const CONFIDENT = 0.2;

const species = (name: string) => name.toLowerCase().split(/\s+/).slice(0, 2).join(' ');

/** The catalogue crop with the same species as an identified plant, if there is one. */
export function catalogueCrop(match: Pick<Match, 'scientific'>, crops: CropProfile[] = CROPS): CropProfile | null {
  const key = species(match.scientific);
  return crops.find((c) => species(c.scientific) === key) ?? null;
}
