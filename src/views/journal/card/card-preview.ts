/* ==========================================================================
   On the Road · Share card — preview overlay
   --------------------------------------------------------------------------
   A self-contained modal that renders the card for an entry to a live canvas,
   lets the user switch ratio, and download the PNG. It mounts itself onto
   <body> and reuses the journal overlay styling for visual consistency.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { buildCardData } from './card-layout.ts';
import { renderCardToCanvas } from './card-canvas.ts';
import { downloadCard } from './card-export.ts';
import { DEFAULT_RATIO, type CardRatio } from './card-spec.ts';

let host: HTMLElement | null = null;

export async function openCardPreview(entry: StoredJournalEntry): Promise<void> {
  closeCardPreview();

  const data = buildCardData(entry);
  let ratio: CardRatio = DEFAULT_RATIO[data.kind];

  host = document.createElement('div');
  host.className = 'journal-composer-overlay journal-card-overlay';
  host.innerHTML = `
    <div class="journal-card-modal">
      <div class="journal-card-modal-head">
        <span class="journal-card-modal-title">${data.emoji} Share card</span>
        <button class="journal-icon-btn" data-card-close type="button" title="Close">✕</button>
      </div>
      <div class="journal-card-stage" data-card-stage>
        <div class="journal-card-loading">Rendering…</div>
      </div>
      <div class="journal-card-modal-foot">
        <div class="journal-card-ratios">
          <button class="journal-filter-chip ${ratio === '3:4' ? 'active' : ''}" data-card-ratio="3:4" type="button">3:4</button>
          <button class="journal-filter-chip ${ratio === '2:3' ? 'active' : ''}" data-card-ratio="2:3" type="button">2:3</button>
        </div>
        <button class="btn btn-primary" data-card-download type="button">Download PNG</button>
      </div>
    </div>
  `;
  document.body.appendChild(host);

  const stage = host.querySelector<HTMLElement>('[data-card-stage]')!;
  let currentCanvas: HTMLCanvasElement | null = null;

  async function rerender() {
    stage.innerHTML = '<div class="journal-card-loading">Rendering…</div>';
    try {
      const canvas = await renderCardToCanvas(data, { ratio });
      currentCanvas = canvas;
      canvas.className = 'journal-card-canvas';
      stage.innerHTML = '';
      stage.appendChild(canvas);
    } catch (err) {
      console.error('Card render failed:', err);
      stage.innerHTML = '<div class="journal-card-loading">Could not render card</div>';
    }
  }

  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target === host || target.closest('[data-card-close]')) {
      closeCardPreview();
      return;
    }

    const ratioBtn = target.closest<HTMLElement>('[data-card-ratio]');
    if (ratioBtn) {
      ratio = ratioBtn.dataset.cardRatio as CardRatio;
      host!.querySelectorAll('[data-card-ratio]').forEach((b) =>
        b.classList.toggle('active', (b as HTMLElement).dataset.cardRatio === ratio));
      void rerender();
      return;
    }

    if (target.closest('[data-card-download]')) {
      if (currentCanvas) void downloadCard(currentCanvas, data.title || data.typeLabel);
      return;
    }
  });

  void rerender();
}

export function closeCardPreview(): void {
  if (host) { host.remove(); host = null; }
}
