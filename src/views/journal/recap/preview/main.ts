/* ==========================================================================
   On the Road · Recap deck preview harness  (DEV ONLY)
   --------------------------------------------------------------------------
   Renders the real deck from canned data: no sign-in, no Firestore, no AI
   credit. Served at /recap-preview.html by `npm run dev`.

   It imports the production render.ts, interact.ts and recap.css, so flipping,
   the progress dots and the Public/Private switch run through the same code the
   app uses. Only the buttons that would spend money or publish are stubbed, and
   they say so.
   ========================================================================== */

import '../../../../core/base.css';
import '../../../../core/theme.ts';
import '../../journal.css';
import { setLocale } from '../../../../core/i18n.ts';
import { flipAll, syncProgress, toggleCard } from '../interact.ts';
import { renderRecap } from '../render.ts';
import { initialRecapUi } from '../types.ts';
import { FIXTURES } from './fixture.ts';
import { ensureCardFonts } from '../../card/card-fonts.ts';
import { CARD_H, CARD_W, drawCardBack } from '../export/draw.ts';
import { exportCandidates } from '../export/select.ts';
import { openExportSheet } from '../export/sheet.ts';
import { renderLongImage } from '../export/long.ts';

const params = new URLSearchParams(location.search);
const ui = initialRecapUi();
let fixtureId = params.get('f') ?? FIXTURES[0].id;
let width: 'desktop' | 'phone' = params.get('w') === 'phone' ? 'phone' : 'desktop';
let bound = false;

// Review shortcuts, so a state can be linked to or screenshotted without clicking:
//   ?open=all | 0,3,5   cards already turned      ?view=public   what a stranger sees
//   ?theme=dark         dark mode                 ?w=phone       390px column
if (params.get('view') === 'public') ui.publicMode = true;
if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const open = params.get('open');
if (open === 'all') for (let i = 0; i < 12; i += 1) ui.flipped.add(i);
else if (open) open.split(',').map(Number).filter(Number.isFinite).forEach((i) => ui.flipped.add(i));

function current() {
  return FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0];
}

function render() {
  const fixture = current();
  setLocale(fixture.lang);

  const stage = document.getElementById('stage')!;
  const deck = document.getElementById('deck')!;
  stage.className = `stage is-${width}`;

  // eslint-disable-next-line no-restricted-syntax -- dev-only harness; fixture text is authored in this repo, never user input
  deck.innerHTML = renderRecap({
    recap: fixture.recap,
    recaps: fixture.recap ? [fixture.recap] : [],
    entryCount: fixture.entryCount,
    minEntries: 8,
    ui,
  });
  if (!bound) { bindDeck(deck); bound = true; }
  paintToolbar();
}

/** The handlers the controller would own, minus anything that costs money. */
function bindDeck(deck: HTMLElement) {
  deck.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const shell = deck.querySelector<HTMLElement>('.journal-recap-shell');
    if (!shell) return;

    const view = target.closest<HTMLElement>('[data-recap-view]');
    if (view) {
      ui.publicMode = view.dataset.recapView === 'public';
      render();

      return;
    }
    if (target.closest('[data-recap-flip-all]')) { flipAll(shell, ui); return; }
    if (target.closest('[data-recap-generate]') || target.closest('[data-recap-regenerate]')) {
      note('Generation is disabled in the preview — switch fixtures from the toolbar instead.');
      return;
    }
    if (target.closest('[data-recap-export]')) {
      const recap = current().recap;
      if (recap) openExportSheet(recap);
      return;
    }
    const chip = target.closest<HTMLElement>('[data-recap-ref]');
    if (chip) { note(`Would open journal entry ${chip.dataset.recapRef} in the reader.`); return; }

    const card = target.closest<HTMLElement>('[data-recap-card]');
    if (card) toggleCard(shell, ui, Number(card.dataset.recapCard));
  });

  deck.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-recap-card]');
    if (!card) return;
    event.preventDefault();
    card.click();
  });
}

function paintToolbar() {
  const bar = document.getElementById('toolbar')!;
  // eslint-disable-next-line no-restricted-syntax -- dev-only harness; all values are literals from this file
  bar.innerHTML = `
    <label>Fixture
      <select id="pick">
        ${FIXTURES.map((f) => `<option value="${f.id}" ${f.id === fixtureId ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
    </label>
    <label>Width
      <select id="w">
        <option value="desktop" ${width === 'desktop' ? 'selected' : ''}>Desktop</option>
        <option value="phone" ${width === 'phone' ? 'selected' : ''}>Phone (390px)</option>
      </select>
    </label>
    <button id="theme" type="button">Toggle theme</button>
    <span class="hint">Click a face-down card to turn it.</span>
  `;

  bar.querySelector<HTMLSelectElement>('#pick')!.onchange = (e) => {
    fixtureId = (e.target as HTMLSelectElement).value;
    ui.flipped.clear();
    ui.publicMode = false;
    history.replaceState(null, '', `?f=${fixtureId}`);
    render();
  };
  bar.querySelector<HTMLSelectElement>('#w')!.onchange = (e) => {
    width = (e.target as HTMLSelectElement).value as typeof width;
    render();
  };
  bar.querySelector<HTMLButtonElement>('#theme')!.onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  };

  const shell = document.querySelector<HTMLElement>('#deck .journal-recap-shell');
  if (shell) syncProgress(shell);
}

function note(message: string) {
  const el = document.getElementById('note')!;
  el.textContent = message;
  el.classList.add('is-on');
  window.setTimeout(() => el.classList.remove('is-on'), 2600);
}

render();

// ?draw=all | 0,3,5   paint the real canvas export of those cards under the deck, so the
// export can be reviewed (and screenshotted) without any click-through.
const draw = params.get('draw');
const recapForDraw = current().recap;
if (draw && recapForDraw) {
  // Never wait on the font network forever in a review page.
  if (params.get('only') === 'draw') document.getElementById('stage')!.style.display = 'none';
  void Promise.race([ensureCardFonts(), new Promise((r) => setTimeout(r, 2500))]).then(() => {
    const cands = exportCandidates(recapForDraw);
    const wanted = draw === 'all' ? cands : cands.filter((c) => draw.split(',').map(Number).includes(c.index));
    const out = document.createElement('div');
    out.style.cssText = 'display:flex;flex-wrap:wrap;gap:18px;margin-top:28px';
    wanted.forEach((c, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      canvas.style.cssText = 'width:360px;height:480px;border:1px solid #ddd;border-radius:6px';
      drawCardBack(canvas.getContext('2d')!, { card: c.card, key: c.key, page: i + 1, total: wanted.length });
      out.appendChild(canvas);
    });
    document.querySelector('.wrap')!.appendChild(out);
  }).catch((error: unknown) => {
    const pre = document.createElement('pre');
    pre.id = 'draw-error';
    pre.textContent = String((error as Error)?.stack ?? error);
    document.querySelector('.wrap')!.appendChild(pre);
  });
}

// ?long=1 builds the real long image and shows it, so the export can be reviewed without a download.
// ?sheet=1 opens the selection sheet. Both are review shortcuts for this page only.
if (params.get('sheet') && current().recap) openExportSheet(current().recap!);
if (params.get('long') && current().recap) {
  const recapForLong = current().recap!;
  void Promise.race([ensureCardFonts(), new Promise((r) => setTimeout(r, 2500))]).then(async () => {
    const logo = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${import.meta.env.BASE_URL}art/logo.png`;
    });
    const cards = exportCandidates(recapForLong).filter((c) => c.hasPublicText && c.flags.length === 0);
    const canvas = renderLongImage({ cards: cards.map((c) => ({ card: c.card, key: c.key })), logo });
    canvas.style.cssText = `width:${params.get('full') ? canvas.width : 540}px;height:auto;display:block;margin:20px auto;border:1px solid #ddd`;
    document.getElementById('stage')!.style.display = 'none';
    document.querySelector('.wrap')!.appendChild(canvas);
    document.title = `long ${canvas.width}x${canvas.height}`;
    if (params.get('tail')) {
      // Show just the last 1500px, full size, so the footer can be inspected.
      const crop = document.createElement('canvas');
      crop.width = canvas.width;
      crop.height = 1500;
      crop.getContext('2d')!.drawImage(canvas, 0, canvas.height - 1500, canvas.width, 1500, 0, 0, canvas.width, 1500);
      crop.style.cssText = 'width:1080px;display:block;margin:20px auto;border:1px solid #ddd';
      canvas.remove();
      document.querySelector('.wrap')!.appendChild(crop);
    }
  });
}
