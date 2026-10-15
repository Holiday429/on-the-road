/* ==========================================================================
   On the Road · Passport — share it
   --------------------------------------------------------------------------
   One button on the passport turns it into a picture (share-image.ts) and
   shows it to the traveller first (share-sheet.ts); from there it goes to the
   phone's share sheet, or downloads. The picture carries only what the passport
   itself shows — nickname, totals, the visited countries, EVERY stamp pressed —
   and an invitation to the site, never a link to this passport. It is drawn as
   the open passport it is, landscape and one fixed size: a fuller passport means
   smaller stamps, never a taller picture. No legal name, document number or date
   of birth ever goes into it, whatever the traveller keeps on their own page.
   Reuses the journal recap's delivery and QR code.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import type { PassportData, PassportStamp } from '../../data/passport.ts';
import { ensureCardFonts } from '../journal/card/card-fonts.ts';
import { previewShare } from './share-sheet.ts';
import { toast } from '../journal/recap/export/ui.ts';
import { SITE_URL } from '../journal/recap/export/qr.ts';
import { mrz, passportNumber, travelLevel } from './bio.ts';
import { nationalityLabel } from '../../data/nationalities.ts';
import type { PassportCover } from '../../data/schema.ts';
import { SHARE_H, SHARE_W, drawPassportShare, type ShareInput } from './share-image.ts';
import { stampImage } from './stamp-raster.ts';

const FILENAME = 'on-the-road-passport.png';

export interface ShareSource {
  nickname: string;
  uid: string;
  issued: string;
  /** ISO alpha-2 the traveller travels as; '' when unsaid. */
  nationality?: string;
  /** How they dressed the booklet; the picture's cloth follows it. */
  cover?: PassportCover;
  /** The portrait on their data page, when they have one. */
  photoUrl?: string;
  data: PassportData;
  /** The stamps pressed onto pages, in book order. */
  pressed: PassportStamp[];
}

/**
 * Every stamp, oldest first — the way they would read on a page. A shared passport is a picture of how many
 * countries the traveller has been to, so none of them is left out; the picture grows instead.
 */
export function stampsForImage(pressed: PassportStamp[]): { shown: PassportStamp[]; extra: number } {
  const byDate = [...pressed].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { shown: byDate, extra: 0 };
}

/** One try at loading `src` into an Image; null on failure or after `ms`. */
function tryImage(src: string, cors: boolean, ms: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(null), ms);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    if (cors) { img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer'; }
    img.src = src;
  });
}

/**
 * An image for the canvas, or null. A failure to load must never stop the export — the picture just goes without it.
 * `cors` is for a picture from another host (the traveller's photo): it must come in a way that leaves the canvas
 * saveable. First the host is asked for permission to draw it; if the image cannot be had that way (a copy the
 * browser cached from the page's own plain <img>, a host that answers differently to a CORS request), the bytes are
 * fetched and drawn from a local copy instead, which can never taint the canvas. Why it failed is logged.
 */
async function loadImage(src: string, cors = false): Promise<HTMLImageElement | null> {
  const direct = await tryImage(src, cors, cors ? 8000 : 4000);
  if (direct || !cors) return direct;
  try {
    // no-store: skip whatever the page's own <img> left in the cache, which may carry no CORS verdict.
    const res = await fetch(src, { mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const img = await tryImage(url, false, 8000);
    // The bytes are decoded into the Image by now; the object URL has done its job.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (img) return img;
    throw new Error('the bytes are not an image');
  } catch (err) {
    console.warn('Passport share: could not use the photo —', err);
    return null;
  }
}

function loadLogo(): Promise<HTMLImageElement | null> {
  return loadImage(`${import.meta.env.BASE_URL}art/logo.png`.replace(/\/{2,}/g, '/'));
}

/** Makes the passport picture. Exported separately so it can be looked at without being delivered. */
export async function renderPassportImage(src: ShareSource): Promise<HTMLCanvasElement> {
  await ensureCardFonts();
  if ('fonts' in document) await document.fonts.load('500 16px "JetBrains Mono"').catch(() => []);
  const { shown, extra } = stampsForImage(src.pressed);
  const [logo, photo, images] = await Promise.all([
    loadLogo(), src.photoUrl && /^https?:/i.test(src.photoUrl) ? loadImage(src.photoUrl, true) : Promise.resolve(null),
    Promise.all(shown.map((s) => stampImage(s))),
  ]);

  // They have a photo and it could not be drawn: say so, rather than leave them wondering where it went.
  if (src.photoUrl && !photo) toast(t('passport.share.noPhoto'));

  const input: ShareInput = {
    nickname: src.nickname,
    passportNo: passportNumber(src.uid),
    issued: src.issued,
    nationality: src.nationality ?? '',
    nationalityLabel: src.nationality ? nationalityLabel(src.nationality) : '',
    coverColor: src.cover?.color,
    photo,
    mrz: mrz({ nickname: src.nickname, nationality: src.nationality ?? '', uid: src.uid }, src.issued),
    level: t(`passport.level.${travelLevel(src.data.countries)}`),
    stats: { countries: src.data.countries, cities: src.data.cities, nights: src.data.nights, trips: src.data.trips },
    words: {
      title: t('passport.cover.title'), issued: t('passport.bio.issued'),
      countries: t('passport.stat.countries'), cities: t('passport.stat.cities'), nights: t('passport.stat.nights'), trips: t('passport.stat.trips'),
      visited: t('passport.record.visited'), more: extra > 0 ? t('passport.share.more', { n: extra }) : '', invite: t('passport.share.invite'),
      nickname: t('passport.bio.nickname'), nationality: t('passport.bio.nationality'), level: t('passport.level'), stamps: t('passport.stamps.title'),
    },
    isos: src.data.stamps.map((s) => s.iso),
    stamps: shown.map((s, i) => ({ image: images[i], rotation: s.rotation })),
    logo,
    url: SITE_URL,
  };
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  drawPassportShare(canvas.getContext('2d')!, input);
  return canvas;
}

/**
 * Makes the picture, shows it to the traveller, and shares or downloads it if they say so. `onReady` fires once
 * the picture exists and the preview has it — the button that started this is free again from that moment.
 */
export async function sharePassport(src: ShareSource, onReady?: () => void): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const canvas = await renderPassportImage(src);
  onReady?.();
  return previewShare({
    canvas, filename: FILENAME, title: t('passport.title'),
    stamps: src.pressed.length, countries: src.data.countries,
  });
}
