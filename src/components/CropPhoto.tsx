import { useEffect, useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CropProfile, cropName } from '../env/crops';
import { useI18n } from '../i18n';
import { isCommonsUpload, photoCredit, type PhotoCredit, shortCredit } from '../plants/photoCredit';
import { colors, radius, spacing } from '../theme/colors';
import { IconButton, Ionicons, tapFeedback } from './ui';

/**
 * A real photo of each crop, from the crop's Wikipedia article (looked up by its
 * scientific name, then its English name) through Wikipedia's public REST API.
 *
 * Copyright: only pictures stored on Wikimedia Commons are used. Commons accepts only
 * free licences (CC BY, CC BY-SA, CC0) and public-domain files; an article picture stored
 * on Wikipedia itself may be a copyrighted "fair use" image, so those are skipped. The
 * viewer names the photographer and licence (read from Commons) and links to the file's
 * page, as CC BY and CC BY-SA require. Nothing is shown offline.
 */

interface Photo {
  thumb: string;
  large: string;
  /** Height ÷ width of the picture. */
  aspect: number;
  /** Wikimedia Commons page of the file (author and licence). */
  filePage: string | null;
  articleTitle: string;
}

const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const LARGE_PX = 1280;
const cache = new Map<string, Promise<Photo | null>>();

interface Summary {
  type?: string;
  title?: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
}

async function summaryPhoto(title: string): Promise<Photo | null> {
  const res = await fetch(SUMMARY + encodeURIComponent(title.replace(/ /g, '_')), { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as Summary;
  if (body.type === 'disambiguation' || !body.thumbnail || !body.originalimage) return null;
  const orig = body.originalimage;
  // Free-licence pictures only (see the note at the top).
  if (!isCommonsUpload(orig.source) || !isCommonsUpload(body.thumbnail.source)) return null;
  // A 1280 px copy for zooming: Wikimedia makes one from the thumbnail URL, but only smaller than the original.
  const large = orig.width > LARGE_PX && body.thumbnail.source.includes('/thumb/') ? body.thumbnail.source.replace(/\/\d+px-/, `/${LARGE_PX}px-`) : orig.source;
  const file = decodeURIComponent(orig.source.split('/').pop() ?? '');
  return {
    thumb: body.thumbnail.source,
    large,
    aspect: orig.height / orig.width,
    filePage: file ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}` : null,
    articleTitle: body.title ?? title,
  };
}

export function loadCropPhoto(crop: Pick<CropProfile, 'id' | 'scientific' | 'en'>): Promise<Photo | null> {
  let p = cache.get(crop.id);
  if (!p) {
    p = (async () => {
      for (const title of [crop.scientific, crop.en].filter((x): x is string => !!x)) {
        try {
          const photo = await summaryPhoto(title);
          if (photo) return photo;
        } catch {
          // Offline or blocked: try the next name, then give up quietly.
        }
      }
      return null;
    })();
    cache.set(crop.id, p);
    // A failed lookup is tried again on the next visit.
    p.then((r) => {
      if (!r) cache.delete(crop.id);
    });
  }
  return p;
}

/** The photographer and licence of a photo, once Commons has answered. */
function usePhotoCredit(filePage: string | null | undefined) {
  const [credit, setCredit] = useState<PhotoCredit | null>(null);
  useEffect(() => {
    setCredit(null);
    if (!filePage) return;
    let live = true;
    photoCredit(filePage).then((c) => live && setCredit(c));
    return () => {
      live = false;
    };
  }, [filePage]);
  return credit;
}

/**
 * The photo of a crop, with its photographer and licence underneath (CC BY and CC BY-SA
 * need the credit where the photo is shown); tap it to open the zoomable viewer.
 * `hideIfMissing` leaves no empty box behind when no photo is found, and `dark` is for
 * photos on a dark background (the crop screen's header).
 */
export function CropPhoto({
  crop,
  size = 76,
  hideIfMissing = false,
  dark = false,
}: {
  crop: CropProfile;
  size?: number;
  hideIfMissing?: boolean;
  dark?: boolean;
}) {
  const { t, language } = useI18n();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadCropPhoto(crop).then((p) => {
      if (!live) return;
      setPhoto(p);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [crop]);

  const credit = usePhotoCredit(photo?.filePage);

  if (!photo) return hideIfMissing && loaded ? null : <View style={[st.thumb, { width: size, height: size }]} />;
  const name = cropName(crop, language);
  return (
    <View style={{ width: size }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={t('photo.open', { crop: name })}
        onPress={() => {
          tapFeedback('light');
          setOpen(true);
        }}
        testID={`photo-${crop.id}`}
      >
        <Image source={{ uri: photo.thumb }} style={[st.thumb, { width: size, height: size }]} resizeMode="cover" />
        <View style={st.zoomBadge} pointerEvents="none">
          <Ionicons name="expand" size={12} color={colors.white} />
        </View>
      </Pressable>
      {credit ? (
        <Text
          style={[st.thumbCredit, { color: dark ? '#d7efe1' : colors.textMuted }]}
          numberOfLines={2}
          accessibilityLabel={t('photo.by', { artist: credit.artist ?? '–', licence: credit.licence ?? '–' })}
          testID={`photo-credit-${crop.id}`}
        >
          {shortCredit(credit)}
        </Text>
      ) : null}
      {open ? <PhotoViewer photo={photo} title={name} scientific={crop.scientific} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/** Full-screen viewer: + and − buttons zoom up to 4×, drag to look around (pinch also works on iPhone). */
function PhotoViewer({ photo, title, scientific, onClose }: { photo: Photo; title: string; scientific: string; onClose: () => void }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  const credit = usePhotoCredit(photo.filePage);
  const baseW = width;
  const baseH = Math.min(width * photo.aspect, height * 0.7);
  const fitW = baseH < width * photo.aspect ? baseH / photo.aspect : baseW;
  const set = (z: number) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 2) / 2)));

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent>
      <View style={[st.viewer, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]} testID="photo-viewer">
        <View style={st.viewerHead}>
          <View style={{ flex: 1 }}>
            <Text style={st.viewerTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={st.viewerSub} numberOfLines={1}>
              {scientific}
            </Text>
          </View>
          <IconButton icon="close" label={t('common.close')} onPress={onClose} tone="glass" testID="photo-close" />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={st.scrollY}
          maximumZoomScale={MAX_ZOOM}
          minimumZoomScale={MIN_ZOOM}
          centerContent
          showsVerticalScrollIndicator={false}
        >
          <ScrollView horizontal contentContainerStyle={st.scrollX} showsHorizontalScrollIndicator={false}>
            <Image
              source={{ uri: photo.large }}
              style={{ width: fitW * zoom, height: fitW * photo.aspect * zoom }}
              resizeMode="contain"
              accessibilityLabel={t('photo.alt', { crop: title })}
            />
          </ScrollView>
        </ScrollView>
        <View style={st.controls}>
          <IconButton icon="remove" label={t('photo.zoomOut')} onPress={() => set(zoom - 0.5)} tone="glass" testID="photo-zoom-out" />
          <Text style={st.zoomText}>{zoom.toFixed(1)}×</Text>
          <IconButton icon="add" label={t('photo.zoomIn')} onPress={() => set(zoom + 0.5)} tone="glass" testID="photo-zoom-in" />
        </View>
        <Pressable accessibilityRole="link" onPress={() => photo.filePage && Linking.openURL(photo.filePage)} disabled={!photo.filePage}>
          {credit && (credit.artist || credit.licence) ? (
            <Text style={st.creditBy} testID="photo-credit-by">
              {t('photo.by', { artist: credit.artist ?? '–', licence: credit.licence ?? '–' })}
            </Text>
          ) : null}
          <Text style={st.credit}>{t('photo.credit', { article: photo.articleTitle })}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  thumb: { borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  zoomBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: { flex: 1, backgroundColor: 'rgba(5,15,10,0.96)' },
  viewerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  viewerTitle: { color: colors.white, fontSize: 18, fontWeight: '700' },
  viewerSub: { color: '#c7d6cc', fontSize: 13, fontStyle: 'italic' },
  scrollY: { flexGrow: 1, justifyContent: 'center' },
  scrollX: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.sm },
  zoomText: { color: colors.white, fontSize: 15, fontWeight: '700', minWidth: 44, textAlign: 'center' },
  thumbCredit: { fontSize: 9, lineHeight: 11, marginTop: 2 },
  creditBy: { color: colors.white, fontSize: 13, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  credit: { color: '#c7d6cc', fontSize: 12, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg, textDecorationLine: 'underline' },
});
