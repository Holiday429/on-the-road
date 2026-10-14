/* ==========================================================================
   On the Road · Passport — share it
   --------------------------------------------------------------------------
   One button on the passport turns it into a picture (share-image.ts) and
   hands it to the phone's share sheet, or downloads it. The picture carries
   only what the passport itself shows — name, totals, the visited countries,
   the latest stamps — and an invitation to the site, never a link to this
   passport. Reuses the journal recap's delivery and QR code.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import type { PassportData, PassportStamp } from '../../data/passport.ts';
import { ensureCardFonts } from '../journal/card/card-fonts.ts';
import { deliverImage } from '../journal/recap/export/save.ts';
import { SITE_URL } from '../journal/recap/export/qr.ts';
import { passportNumber, travelLevel } from './bio.ts';
import { MAX_SHARE_STAMPS, SHARE_H, SHARE_W, drawPassportShare, type ShareInput } from './share-image.ts';
import { stampImage } from './stamp-raster.ts';

const FILENAME = 'on-the-road-passport.png';

export interface ShareSource {
  nickname: string;
  uid: string;
  issued: string;
  data: PassportData;
  /** The stamps pressed onto pages, in book order. */
  pressed: PassportStamp[];
}

/** The latest stamps that fit, oldest first (the way they would read on a page), and how many were left out. */
export function stampsForImage(pressed: PassportStamp[]): { shown: PassportStamp[]; extra: number } {
  const byDate = [...pressed].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const shown = byDate.slice(-MAX_SHARE_STAMPS);
  return { shown, extra: byDate.length - shown.length };
}

function loadLogo(): Promise<HTMLImageElement | null> {
  const art = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');
  return new Promise((resolve) => {
    const img = new Image();
    // A logo that fails to load must never stop the export — the picture just goes without it.
    const timer = window.setTimeout(() => resolve(null), 4000);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    img.src = `${art}logo.png`;
  });
}

/** Makes the passport picture. Exported separately so it can be looked at without being delivered. */
export async function renderPassportImage(src: ShareSource): Promise<HTMLCanvasElement> {
  await ensureCardFonts();
  if ('fonts' in document) await document.fonts.load('500 16px "JetBrains Mono"').catch(() => []);
  const { shown, extra } = stampsForImage(src.pressed);
  const [logo, images] = await Promise.all([loadLogo(), Promise.all(shown.map((s) => stampImage(s)))]);

  const input: ShareInput = {
    nickname: src.nickname,
    passportNo: passportNumber(src.uid),
    issued: src.issued,
    level: t(`passport.level.${travelLevel(src.data.countries)}`),
    stats: { countries: src.data.countries, cities: src.data.cities, nights: src.data.nights, trips: src.data.trips },
    words: {
      title: t('passport.cover.title'), issued: t('passport.bio.issued'),
      countries: t('passport.stat.countries'), cities: t('passport.stat.cities'), nights: t('passport.stat.nights'), trips: t('passport.stat.trips'),
      visited: t('passport.record.visited'), more: extra > 0 ? t('passport.share.more', { n: extra }) : '', invite: t('passport.share.invite'),
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

/** Makes the picture and shares or downloads it. */
export async function sharePassport(src: ShareSource): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const canvas = await renderPassportImage(src);
  return deliverImage(canvas, FILENAME, t('passport.title'));
}
