/* ==========================================================================
   On the Road · Passport — look before you share
   --------------------------------------------------------------------------
   The picture is made first and shown to the traveller: a passport they are
   about to post is worth a look, and a tall one (many stamps) needs scrolling
   to read. From here it goes to the system share sheet or straight to a
   download — or nowhere at all, which is why the preview exists.

   The canvas itself is put on the page rather than a copy of it: one image,
   however many megabytes it is, and nothing to keep in sync.
   ========================================================================== */

import { openModal } from '../../core/modal.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { deliverImage, type Delivery } from '../journal/recap/export/save.ts';
import { downloadCard } from '../journal/card/card-export.ts';

export type PreviewChoice = Delivery;

export interface PreviewOpts {
  /** The finished picture. */
  canvas: HTMLCanvasElement;
  /** File name for a download, with the extension. */
  filename: string;
  /** Title for the system share sheet. */
  title: string;
  /** How many stamps the picture carries, for the line under it. */
  stamps: number;
  countries: number;
}

/**
 * Shows the picture and waits for the traveller to decide. Resolves with what happened — 'cancelled' when they
 * closed it, which is an answer, not a failure.
 */
export function previewShare(o: PreviewOpts): Promise<PreviewChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (choice: PreviewChoice) => {
      if (done) return;
      done = true;
      resolve(choice);
    };

    const canShare = typeof navigator.share === 'function';
    const modal = openModal({
      title: t('passport.share.preview'),
      className: 'pp-share-modal',
      body: `<div class="pp-share-preview" data-pp-preview></div>
        <p class="pp-share-note">${esc(t('passport.share.note', { n: o.stamps, c: o.countries }))}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-pp-share-cancel>${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn-ghost" data-pp-share-save>${esc(t('passport.share.download'))}</button>
        ${canShare ? `<button type="button" class="btn btn-primary" data-pp-share-go>${esc(t('passport.share'))}</button>` : ''}`,
      onClose: () => finish('cancelled'),
    });

    const host = modal.root.querySelector<HTMLElement>('[data-pp-preview]');
    o.canvas.className = 'pp-share-canvas';
    // The picture is drawn at full size; on screen it is as wide as the sheet allows.
    o.canvas.style.aspectRatio = `${o.canvas.width} / ${o.canvas.height}`;
    host?.append(o.canvas);

    const busy = (on: boolean) => {
      modal.root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = on; });
    };

    modal.root.querySelector('[data-pp-share-cancel]')?.addEventListener('click', () => { finish('cancelled'); modal.close(); });

    modal.root.querySelector('[data-pp-share-save]')?.addEventListener('click', async () => {
      busy(true);
      try {
        await downloadCard(o.canvas, o.filename.replace(/\.png$/i, ''));
        finish('downloaded');
        modal.close();
      } finally { busy(false); }
    });

    modal.root.querySelector('[data-pp-share-go]')?.addEventListener('click', async () => {
      busy(true);
      try {
        const how = await deliverImage(o.canvas, o.filename, o.title);
        // A share sheet the traveller dismissed leaves the preview up — they may still want to download it.
        if (how === 'cancelled') return;
        finish(how);
        modal.close();
      } finally { busy(false); }
    });
  });
}
