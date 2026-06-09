/* ==========================================================================
   On the Road · Safety city modal — full city safety card in a popup
   ========================================================================== */

import type { StoredCitySafety } from '../../data/stores/safety-store.ts';
import { escHtml as esc } from '../../core/utils.ts';

function telHref(number: string): string {
  return `tel:${number.replace(/[^+0-9]/g, '')}`;
}

function mapSearchUrl(name: string, city: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${city}`)}`;
}

function listSection(icon: string, title: string, items: string[]): string {
  if (!items.length) return '';
  return `
    <div class="sfym-section">
      <div class="sfym-section-title">${icon} ${title}</div>
      <ul class="sfym-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`;
}

function renderModal(card: StoredCitySafety): string {
  const numbers = card.emergencyNumbers.filter((n) => n.number || n.label);
  const numbersHtml = numbers.length ? `
    <div class="sfym-section">
      <div class="sfym-section-title">🚨 Emergency numbers</div>
      <div class="sfym-numgrid">
        ${numbers.map((n) => `
          <a class="sfym-numchip" href="${telHref(n.number || '112')}">
            <span class="sfym-numchip-label">${esc(n.label)}</span>
            <strong class="sfym-numchip-num">${esc(n.number || '—')}</strong>
          </a>`).join('')}
      </div>
    </div>` : '';

  const e = card.embassy;
  const hasEmbassy = e && (e.name || e.address || e.phone);
  const embassyHtml = hasEmbassy ? `
    <div class="sfym-section">
      <div class="sfym-section-title">🏛 ${esc(e.nationality || 'Your')} embassy</div>
      <div class="sfym-place-card">
        ${e.name ? `<div class="sfym-place-name">${esc(e.name)}</div>` : ''}
        ${e.address ? `<div class="sfym-place-line">${esc(e.address)}</div>` : ''}
        ${e.phone ? `<a class="sfym-place-line sfym-link" href="${telHref(e.phone)}">${esc(e.phone)}</a>` : ''}
        ${e.website ? `<a class="sfym-place-line sfym-link" href="${esc(e.website)}" target="_blank" rel="noopener">${esc(e.website)}</a>` : ''}
        ${e.name ? `<a class="sfym-maps-btn" href="${mapSearchUrl(e.name, card.city)}" target="_blank" rel="noopener">📍 View on map</a>` : ''}
      </div>
    </div>` : '';

  const hospitals = card.hospitals.filter((h) => h.name);
  const hospitalsHtml = hospitals.length ? `
    <div class="sfym-section">
      <div class="sfym-section-title">🏥 Hospitals &amp; pharmacies</div>
      ${hospitals.map((h) => `
        <div class="sfym-place-card">
          <div class="sfym-place-name">${esc(h.name)}${h.is24h ? ' <span class="sfym-tag-24h">24h</span>' : ''}</div>
          ${h.address ? `<div class="sfym-place-line">${esc(h.address)}</div>` : ''}
          ${h.phone ? `<a class="sfym-place-line sfym-link" href="${telHref(h.phone)}">${esc(h.phone)}</a>` : ''}
          <a class="sfym-maps-btn" href="${mapSearchUrl(h.name, card.city)}" target="_blank" rel="noopener">📍 View on map</a>
        </div>`).join('')}
    </div>` : '';

  const phrases = card.phrases.filter((p) => p.en);
  const phrasesHtml = phrases.length ? `
    <div class="sfym-section">
      <div class="sfym-section-title">💬 Emergency phrases</div>
      ${phrases.map((p) => `
        <div class="sfym-phrase">
          <div class="sfym-phrase-en">${esc(p.en)}</div>
          <div class="sfym-phrase-local">${esc(p.local || '—')}${p.pronunciation ? ` <span class="sfym-muted">/${esc(p.pronunciation)}/</span>` : ''}</div>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="sfym-overlay" id="sfy-city-modal">
      <div class="sfym-panel" role="dialog" aria-modal="true">
        <div class="sfym-header">
          <div class="sfym-header-city">
            <span class="sfym-header-flag">${esc(card.flag) || '🛡️'}</span>
            <div>
              <div class="sfym-header-name">${esc(card.city)}</div>
              <div class="sfym-header-country">${esc(card.country)}</div>
            </div>
          </div>
          <div class="sfym-header-actions">
            <button class="btn btn-ghost sfy-sm sfym-regen" id="sfym-regen">Regenerate</button>
            <button class="sfym-close" id="sfym-close" aria-label="Close">×</button>
          </div>
        </div>

        <div class="sfym-body">
          <div class="sfym-sos-row">
            <a class="sfym-sos-btn" href="${telHref(card.generalEmergency || '112')}">
              <span>☎</span> ${esc(card.generalEmergency || '112')} <span class="sfym-sos-label">General emergency</span>
            </a>
          </div>

          ${numbersHtml}
          ${embassyHtml}
          ${hospitalsHtml}
          ${listSection('🚕', 'Trusted transport', card.trustedTransport)}
          ${listSection('🚷', 'Areas & times to avoid', card.areasToAvoid)}
          ${listSection('🎭', 'Common scams', card.commonScams)}
          ${phrasesHtml}
          ${listSection('👜', 'Solo women tips', card.womenTips)}
        </div>

        <div class="sfym-footer">
          Updated ${new Date(card.updatedAt ?? Date.now()).toLocaleDateString()}
          ${card.source === 'edited' ? ' · edited' : ''}
        </div>
      </div>
    </div>`;
}

export function openCityModal(
  card: StoredCitySafety,
  onRegen: (card: StoredCitySafety) => void,
  onClose: () => void,
): void {
  document.getElementById('sfy-city-modal')?.remove();

  const div = document.createElement('div');
  div.innerHTML = renderModal(card);
  const modal = div.firstElementChild as HTMLElement;
  document.body.appendChild(modal);

  const close = () => { modal.remove(); onClose(); };

  modal.querySelector('#sfym-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  modal.querySelector('#sfym-regen')?.addEventListener('click', () => {
    close();
    onRegen(card);
  });

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  // Trap scroll inside modal
  requestAnimationFrame(() => modal.querySelector<HTMLElement>('.sfym-panel')?.focus());
}

export function closeCityModal(): void {
  document.getElementById('sfy-city-modal')?.remove();
}
