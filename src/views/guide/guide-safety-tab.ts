/* ==========================================================================
   On the Road · Guide — Safety tab
   --------------------------------------------------------------------------
   Safety no longer has its own nav entry — this renders the same content
   (emergency numbers, embassy, hospitals, area/scam warnings, phrases) as a
   Guide tab instead. citySafety stays its own Firestore collection (same
   trip/{tripId}/citySafety/{slugId} path, keyed identically to cityIntel so
   the two docs share a city without any migration) — the iOS app and the
   /api/safety endpoint both still read/write that shape directly.

   Credit accounting (important — don't undo this): the numbers/hospitals/
   areas/scams shown here mostly come free, as the 9th SSE section of the
   already-paid /api/guide request (see guide.ts's applySafetySection). This
   module's own auto-fill only ever touches the free static country library
   (src/data/safety-static/countries.ts) — it must NEVER call fetchCitySafety's
   AI path automatically, since that hits the chargeable /api/safety endpoint.
   Full AI enrichment (embassy, phrases, women's tips) is only ever triggered
   by the explicit "Generate full safety card" button, exactly like the old
   safety.ts's Regenerate action.
   ========================================================================== */

import { safetyStore, type StoredCitySafety } from '../../data/stores/safety-store.ts';
import { safetyProfileStore } from '../../data/stores/safety-profile-store.ts';
import { fetchCitySafety, type GeneratedSafety } from '../../data/safety-generate.ts';
import { staticSafetyForCountry } from '../../data/safety-static/countries.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl, slugId } from '../../core/utils.ts';

let _card: StoredCitySafety | null = null;
let _staticSeeded = false;
let _enriching = false;

function nationality(): string {
  return safetyProfileStore.peek()?.nationality ?? '';
}

function telHref(number: string): string {
  return `tel:${number.replace(/[^+0-9]/g, '')}`;
}

function mapSearchUrl(name: string, city: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${city}`)}`;
}

function listSection(icon: string, title: string, items: string[]): string {
  if (!items.length) return '';
  return `
    <details class="guide-safety-section">
      <summary>${icon} ${esc(title)}</summary>
      <ul class="guide-safety-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </details>`;
}

/** Free-only seed: if no citySafety doc exists yet, write the static-library
 *  entry for this country (if we have one) so the phone strip is instantly
 *  populated. Never calls the AI endpoint — see the file-header note. */
async function seedFromStaticLibrary(city: string, country: string): Promise<void> {
  if (_card || _staticSeeded) return;
  _staticSeeded = true;
  const data = staticSafetyForCountry(city, country);
  if (data) await safetyStore.save({ id: slugId(city), ...data, source: 'ai' });
}

/** Merge the guide generation's slim safety section (numbers/hospitals/areas/
 *  scams only) into the citySafety doc. Called by guide.ts when the SSE
 *  'safety' section arrives — free, part of the already-charged guide credit.
 *  Never overwrites a field the static library or a user edit already filled;
 *  only fills gaps, and only while the card hasn't been hand-edited. */
export async function applyGuidePipelineSafety(
  city: string,
  payload: {
    generalEmergency: string;
    emergencyNumbers: { label: string; number: string }[];
    hospitals: { name: string; address: string; phone: string; is24h: boolean }[];
    areasToAvoid: string[];
    commonScams: string[];
  },
): Promise<void> {
  const id = slugId(city);
  const existing = safetyStore.peek().find((r) => r.id === id);
  if (existing?.source === 'edited') return; // never clobber a user's edits

  const hasNumbers = !!existing?.emergencyNumbers?.length;
  const hasHospitals = !!existing?.hospitals?.length;
  await safetyStore.save({
    id,
    city,
    country: existing?.country ?? '',
    generalEmergency: existing?.generalEmergency || payload.generalEmergency,
    emergencyNumbers: hasNumbers ? existing!.emergencyNumbers : payload.emergencyNumbers,
    hospitals: hasHospitals ? existing!.hospitals : payload.hospitals,
    areasToAvoid: existing?.areasToAvoid?.length ? existing.areasToAvoid : payload.areasToAvoid,
    commonScams: existing?.commonScams?.length ? existing.commonScams : payload.commonScams,
    source: 'ai',
  });
}

/** User-triggered full enrichment (embassy/phrases/women's tips) — hits the
 *  chargeable /api/safety endpoint via fetchCitySafety, same cost as the old
 *  standalone Safety view's "Regenerate" action. */
export async function regenerateFullSafety(city: string, country: string): Promise<void> {
  if (_enriching) return;
  _enriching = true;
  try {
    const data = await fetchCitySafety(city, country, nationality());
    if (data) await safetyStore.save({ id: slugId(city), ...data, source: 'ai' });
  } finally {
    _enriching = false;
  }
}

export function renderSafetyTab(city: string, country: string): string {
  const card = _card;
  const staticFallback: GeneratedSafety | null = card ? null : staticSafetyForCountry(city, country);
  const general = card?.generalEmergency || staticFallback?.generalEmergency || '112';
  const numbers = (card?.emergencyNumbers ?? staticFallback?.emergencyNumbers ?? []).filter((n) => n.number || n.label);

  const phoneStrip = `
    <div class="guide-safety-sos">
      <a class="guide-safety-sos-btn" href="${telHref(general)}">
        <span>☎</span> ${esc(general)} <span class="guide-safety-sos-label">${t('safety.generalEmergency')}</span>
      </a>
      ${numbers.length ? `
      <div class="guide-safety-numgrid-wrap">
        <div class="guide-safety-numgrid-label">${t('safety.emergencyNumbers')}</div>
        <div class="guide-safety-numgrid">
          ${numbers.map((n) => `
            <a class="guide-safety-numchip" href="${telHref(n.number || general)}">
              <span class="guide-safety-numchip-label">${esc(n.label)}</span>
              <strong class="guide-safety-numchip-num">${esc(n.number || '—')}</strong>
            </a>`).join('')}
        </div>
      </div>` : ''}
    </div>`;

  void seedFromStaticLibrary(city, country);

  const e = card?.embassy;
  const hasEmbassy = e && (e.name || e.address || e.phone);
  const embassyHtml = hasEmbassy ? `
    <details class="guide-safety-section" open>
      <summary>🛂 ${esc(t('safety.yourEmbassy', { nationality: e!.nationality || t('safety.destinationDefault') }))}</summary>
      <div class="guide-safety-place">
        ${e!.name ? `<div class="guide-safety-place-name">${esc(e!.name)}</div>` : ''}
        ${e!.address ? `<div class="guide-safety-place-line">${esc(e!.address)}</div>` : ''}
        ${e!.phone ? `<a class="guide-safety-place-line guide-safety-link" href="${telHref(e!.phone)}">${esc(e!.phone)}</a>` : ''}
        ${e!.website ? `<a class="guide-safety-place-line guide-safety-link" href="${safeUrl(e!.website)}" target="_blank" rel="noopener">${esc(e!.website)}</a>` : ''}
        ${e!.name ? `<a class="guide-safety-maps-btn" href="${mapSearchUrl(e!.name, city)}" target="_blank" rel="noopener">📍 ${t('guide.btnOpenMap')}</a>` : ''}
      </div>
    </details>` : '';

  const hospitals = card?.hospitals.filter((h) => h.name) ?? [];
  const hospitalsHtml = hospitals.length ? `
    <details class="guide-safety-section">
      <summary>${t('safety.hospitalsTitle')}</summary>
      ${hospitals.map((h) => `
        <div class="guide-safety-place">
          <div class="guide-safety-place-name">${esc(h.name)}${h.is24h ? ` <span class="guide-safety-tag-24h">${t('safety.badge24h')}</span>` : ''}</div>
          ${h.address ? `<div class="guide-safety-place-line">${esc(h.address)}</div>` : ''}
          ${h.phone ? `<a class="guide-safety-place-line guide-safety-link" href="${telHref(h.phone)}">${esc(h.phone)}</a>` : ''}
          <a class="guide-safety-maps-btn" href="${mapSearchUrl(h.name, city)}" target="_blank" rel="noopener">📍 ${t('guide.btnOpenMap')}</a>
        </div>`).join('')}
    </details>` : '';

  const phrases = card?.phrases.filter((p) => p.en) ?? [];
  const phrasesHtml = phrases.length ? `
    <details class="guide-safety-section">
      <summary>${t('safety.phrasesTitle')}</summary>
      ${phrases.map((p) => `
        <div class="guide-safety-phrase">
          <div class="guide-safety-phrase-en">${esc(p.en)}</div>
          <div class="guide-safety-phrase-local">${esc(p.local || '—')}${p.pronunciation ? ` <span class="guide-safety-muted">/${esc(p.pronunciation)}/</span>` : ''}</div>
        </div>`).join('')}
    </details>` : '';

  // Only offer full enrichment once the free tiers have had a chance to land
  // and there's still nothing beyond numbers/hospitals (no embassy/phrases).
  const offerEnrich = !hasEmbassy && !phrases.length && !_enriching;

  return `${phoneStrip}
    ${embassyHtml}
    ${hospitalsHtml}
    ${listSection('🚕', t('guide.safetyTransport'), card?.trustedTransport ?? [])}
    ${listSection('🚷', t('guide.safetyAreas'), card?.areasToAvoid ?? [])}
    ${listSection('🎭', t('guide.safetyScams'), card?.commonScams ?? [])}
    ${phrasesHtml}
    ${listSection('👜', t('guide.safetyWomenTips'), card?.womenTips ?? [])}
    ${offerEnrich ? `<button class="btn btn-ghost guide-safety-enrich-btn" id="guide-safety-enrich">${t('guide.safetyEnrichBtn')}</button>` : ''}
    ${card ? `<div class="guide-safety-footer">
      ${t('safety.updatedLabel')}${new Date(card.updatedAt ?? Date.now()).toLocaleDateString()}
      ${card.source === 'edited' ? t('safety.editedLabel') : ''}
    </div>` : ''}`;
}

export function wireSafetyTab(root: HTMLElement, city: string, country: string, onDone: () => void): void {
  root.querySelector<HTMLButtonElement>('#guide-safety-enrich')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = t('guide.safetyEnriching');
    await regenerateFullSafety(city, country);
    onDone();
  });
}

/** Subscribe once per city (called from Guide's tab-switch handler). Returns
 *  an unsubscribe fn the caller should call before subscribing to a new city. */
export function subscribeSafetyTab(city: string, onChange: () => void): () => void {
  _card = null;
  _staticSeeded = false;
  const id = slugId(city);
  return safetyStore.subscribe((rows) => {
    _card = rows.find((r) => r.id === id) ?? null;
    onChange();
  });
}
