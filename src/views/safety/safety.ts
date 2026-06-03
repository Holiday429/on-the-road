/* ==========================================================================
   On the Road · Safety — solo female travel toolkit
   --------------------------------------------------------------------------
   Four stacked blocks:
     1. SOS bar      — always visible, current-city emergency numbers + share
     2. My card      — personal/emergency/medical/insurance form (user-scoped)
     3. City cards   — AI-seeded, hand-correctable, sourced from itinerary legs
     4. Essentials   — static solo-female checklists, trip-wide
   Tone is calm and empowering, not alarmist.
   ========================================================================== */

import './safety.css';
import { safetyStore, type StoredCitySafety } from '../../data/stores/safety-store.ts';
import { safetyProfileStore, type StoredSafetyProfile } from '../../data/stores/safety-profile-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { NATIONALITIES, DIAL_CODES, nationalityFlag, nationalityLabel } from '../../data/nationalities.ts';
import { fetchCitySafety } from './generate.ts';
import { ESSENTIALS } from './essentials.ts';
import { uploadInsurancePdf } from '../../firebase/storage.ts';
import type { SafetyProfile } from '../../data/schema.ts';

let _cards: StoredCitySafety[] = [];
let _legs: StoredLeg[] = [];
let _profile: StoredSafetyProfile | null = null;
let _unsubProfile: (() => void) | null = null;
let _unsubLegs: (() => void) | null = null;
let _unsubCards: (() => void) | null = null;
let openCardId: string | null = null;
let editingProfile = false;

function esc(v: string): string {
  return v
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
/** Build a tel: href from a dialCode + local number, or a pre-combined string. */
function telHref(dialCode: string, local: string): string;
function telHref(combined: string): string;
function telHref(a: string, b?: string): string {
  const raw = b !== undefined ? `${a}${b}` : a;
  return `tel:${raw.replace(/[^+0-9]/g, '')}`;
}
function fullPhone(dialCode: string, local: string): string {
  if (!dialCode && !local) return '';
  return `${dialCode} ${local}`.trim();
}

/* ── Current leg (drives the SOS bar) ──────────────────────────────────────
   The leg whose date range contains today; else the next upcoming; else last. */
function currentLeg(): StoredLeg | null {
  if (_legs.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const here = sorted.find((l) => l.dateFrom <= today && l.dateTo >= today);
  if (here) return here;
  const upcoming = sorted.find((l) => l.dateFrom >= today);
  return upcoming ?? sorted[sorted.length - 1];
}

function cardFor(leg: StoredLeg | null): StoredCitySafety | null {
  if (!leg) return null;
  return _cards.find((c) => c.id === slugId(leg.city)) ?? null;
}

/* ── SOS bar ────────────────────────────────────────────────────────────── */
function renderSos(): string {
  const leg = currentLeg();
  const card = cardFor(leg);
  const cityName = leg?.city ?? 'your destination';
  const general = card?.generalEmergency || '112';

  const nums = (card?.emergencyNumbers ?? []).filter((n) => n.number).slice(0, 4);
  const numChips = nums.length
    ? nums.map((n) => `
        <a class="sos-num" href="${telHref(n.number)}">
          <span class="sos-num-label">${esc(n.label)}</span>
          <span class="sos-num-value">${esc(n.number)}</span>
        </a>`).join('')
    : `<div class="sos-hint">Generate ${esc(cityName)}'s card below for local police / ambulance numbers.</div>`;

  return `
    <div class="sos-bar">
      <div class="sos-main">
        <div class="sos-label">Emergency · ${esc(cityName)}</div>
        <a class="sos-dial" href="${telHref(general)}">
          <span class="sos-dial-icon">☎</span>
          <span class="sos-dial-num">${esc(general)}</span>
          <span class="sos-dial-sub">tap to call</span>
        </a>
      </div>
      <div class="sos-nums">${numChips}</div>
      <button class="btn sos-share" id="sos-share">📍 Share my location</button>
    </div>
  `;
}

/* ── Personal / emergency card ──────────────────────────────────────────── */
function natOptions(selected: string): string {
  const blank = `<option value="" ${selected ? '' : 'selected'}>Select…</option>`;
  return blank + NATIONALITIES.map((n) =>
    `<option value="${n.code}" ${n.code === selected ? 'selected' : ''}>${n.flag} ${esc(n.label)}</option>`,
  ).join('');
}

function dialOptions(selected: string): string {
  const blank = `<option value="" ${selected ? '' : 'selected'}>＋</option>`;
  return blank + DIAL_CODES.map((d) =>
    `<option value="${d.dialCode}" ${d.dialCode === selected ? 'selected' : ''}>${esc(d.label)}</option>`,
  ).join('');
}

/** Render a split-input phone row: [dial-code select] [local number input]. */
function phoneField(dialId: string, localId: string, dialVal: string, localVal: string, label: string): string {
  return `
    <label class="field-label">${label}</label>
    <div class="sfy-phone-row">
      <select class="input select sfy-dial-select" id="${dialId}">${dialOptions(dialVal)}</select>
      <input class="input sfy-phone-local" id="${localId}" type="tel" value="${esc(localVal)}" placeholder="number">
    </div>`;
}

function renderProfileView(): string {
  const p = _profile;
  const primary = p?.emergencyContacts?.find((c) => c.isPrimary) ?? p?.emergencyContacts?.[0];
  const hasAny = !!p && (p.nationality || (p.emergencyContacts?.length ?? 0) > 0 ||
    p.bloodType || p.allergies || p.medications || p.insurancePolicy);

  if (!hasAny) {
    return `
      <div class="sfy-card sfy-profile">
        <div class="sfy-card-head">
          <div class="sfy-card-title">🆘 My emergency card</div>
          <button class="btn btn-primary sfy-sm" id="profile-edit">Set up</button>
        </div>
        <p class="sfy-empty-line">Add your nationality, emergency contact, blood type and insurance.
        Kept on your account, ready to show a medic or consulate — even offline.</p>
      </div>`;
  }

  const contacts = (p!.emergencyContacts ?? []).map((c) => {
    const phone = fullPhone(c.dialCode, c.phone);
    return `
    <a class="sfy-contact" href="${phone ? telHref(c.dialCode, c.phone) : '#'}">
      <span class="sfy-contact-name">${esc(c.name)}${c.relation ? ` · ${esc(c.relation)}` : ''}${c.isPrimary ? ' ⭐' : ''}</span>
      <span class="sfy-contact-phone">${esc(phone || '—')}</span>
    </a>`;
  }).join('');

  const med = [
    p!.bloodType && ['Blood type', p!.bloodType],
    p!.allergies && ['Allergies', p!.allergies],
    p!.medications && ['Medications', p!.medications],
    p!.conditions && ['Conditions', p!.conditions],
  ].filter(Boolean) as [string, string][];

  const ins = [
    p!.insuranceProvider && ['Insurer', p!.insuranceProvider],
    p!.insurancePolicy && ['Policy', p!.insurancePolicy],
    p!.insuranceHotline && ['24h hotline', p!.insuranceHotline],
  ].filter(Boolean) as [string, string][];

  const facts = (rows: [string, string][]) => rows.map(([k, v]) =>
    `<div class="sfy-fact"><span class="sfy-fact-k">${k}</span><span class="sfy-fact-v">${esc(v)}</span></div>`).join('');

  const pdfLink = p!.insurancePdfUrl
    ? `<a class="sfy-pdf-link" href="${esc(p!.insurancePdfUrl)}" target="_blank" rel="noopener">
        📄 ${esc(p!.insurancePdfName || 'Insurance PDF')}
       </a>`
    : '';

  return `
    <div class="sfy-card sfy-profile">
      <div class="sfy-card-head">
        <div class="sfy-card-title">🆘 My emergency card</div>
        <button class="btn btn-ghost sfy-sm" id="profile-edit">Edit</button>
      </div>
      <div class="sfy-profile-grid">
        ${p!.nationality ? `<div class="sfy-prof-block"><div class="sfy-block-label">Nationality</div>
          <div class="sfy-nat">${nationalityFlag(p!.nationality)} ${esc(nationalityLabel(p!.nationality))}</div></div>` : ''}
        ${contacts ? `<div class="sfy-prof-block"><div class="sfy-block-label">Emergency contacts</div>${contacts}</div>` : ''}
        ${med.length ? `<div class="sfy-prof-block"><div class="sfy-block-label">Medical</div>${facts(med)}</div>` : ''}
        ${(ins.length || pdfLink) ? `<div class="sfy-prof-block"><div class="sfy-block-label">Insurance</div>${facts(ins)}${pdfLink}</div>` : ''}
      </div>
      ${p!.notes ? `<div class="sfy-prof-notes">${esc(p!.notes)}</div>` : ''}
      ${primary ? `<a class="btn btn-primary sfy-call-primary" href="${telHref(primary.dialCode, primary.phone)}">📞 Call ${esc(primary.name || 'emergency contact')}</a>` : ''}
    </div>`;
}

function renderProfileForm(): string {
  const p = _profile;
  const c0 = p?.emergencyContacts?.[0] ?? { name: '', relation: '', dialCode: '', phone: '', isPrimary: true };
  const c1 = p?.emergencyContacts?.[1] ?? { name: '', relation: '', dialCode: '', phone: '', isPrimary: false };
  const f = (id: string, val: string, ph: string, label: string) => `
    <label class="field-label">${label}</label>
    <input class="input" id="${id}" value="${esc(val)}" placeholder="${esc(ph)}">`;

  const pdfCurrent = p?.insurancePdfUrl
    ? `<div class="sfy-pdf-current">
        <a href="${esc(p.insurancePdfUrl)}" target="_blank" rel="noopener" class="sfy-pdf-link">
          📄 ${esc(p.insurancePdfName || 'Current PDF')}
        </a>
        <span class="sfy-muted"> · upload a new file to replace</span>
       </div>`
    : '';

  return `
    <div class="sfy-card sfy-profile sfy-form" id="profile-form">
      <div class="sfy-card-head">
        <div class="sfy-card-title">🆘 My emergency card</div>
      </div>
      <div class="sfy-form-grid">
        <div class="sfy-form-col">
          <label class="field-label">Nationality <span class="sfy-muted">(picks your embassy)</span></label>
          <select class="input select" id="pf-nat">${natOptions(p?.nationality ?? '')}</select>
          ${f('pf-blood', p?.bloodType ?? '', 'e.g. O+', 'Blood type')}
          ${f('pf-allergy', p?.allergies ?? '', 'penicillin, nuts…', 'Allergies')}
          ${f('pf-meds', p?.medications ?? '', 'anything you take regularly', 'Medications')}
          ${f('pf-cond', p?.conditions ?? '', 'asthma, diabetes…', 'Conditions')}
        </div>
        <div class="sfy-form-col">
          <div class="sfy-block-label">Emergency contact 1 ⭐</div>
          ${f('pf-c0-name', c0.name, 'name', 'Name')}
          ${f('pf-c0-rel', c0.relation, 'mum / partner / friend', 'Relation')}
          ${phoneField('pf-c0-dial', 'pf-c0-phone', c0.dialCode, c0.phone, 'Phone')}
          <div class="sfy-block-label" style="margin-top:var(--sp-4)">Emergency contact 2</div>
          ${f('pf-c1-name', c1.name, 'name', 'Name')}
          ${phoneField('pf-c1-dial', 'pf-c1-phone', c1.dialCode, c1.phone, 'Phone')}
        </div>
        <div class="sfy-form-col">
          ${f('pf-ins-prov', p?.insuranceProvider ?? '', 'insurer', 'Travel insurer')}
          ${f('pf-ins-policy', p?.insurancePolicy ?? '', 'policy no.', 'Policy number')}
          ${f('pf-ins-hot', p?.insuranceHotline ?? '', '24h assistance line', 'Insurance hotline')}
          <label class="field-label">Insurance policy PDF</label>
          ${pdfCurrent}
          <div class="sfy-upload-wrap">
            <label class="sfy-upload-btn" for="pf-pdf-input">
              <span id="pf-pdf-label">📎 Choose PDF…</span>
              <input type="file" id="pf-pdf-input" accept=".pdf,application/pdf" style="display:none">
            </label>
            <span class="sfy-upload-status" id="pf-pdf-status"></span>
          </div>
          <label class="field-label">Notes</label>
          <textarea class="input" id="pf-notes" rows="3" placeholder="anything a medic should know">${esc(p?.notes ?? '')}</textarea>
        </div>
      </div>
      <div class="sfy-form-actions">
        <button class="btn btn-ghost sfy-sm" id="profile-cancel">Cancel</button>
        <button class="btn btn-primary sfy-sm" id="profile-save">Save</button>
      </div>
    </div>`;
}

/* ── City safety cards ──────────────────────────────────────────────────── */
function listBlock(icon: string, title: string, items: string[]): string {
  if (!items.length) return '';
  return `
    <div class="sfy-sec">
      <div class="sfy-sec-title">${icon} ${title}</div>
      <ul class="sfy-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`;
}

function renderCardDetail(card: StoredCitySafety): string {
  const open = openCardId === card.id;
  const numbers = card.emergencyNumbers.filter((n) => n.number || n.label);
  const numbersHtml = numbers.length ? `
    <div class="sfy-sec">
      <div class="sfy-sec-title">🚨 Emergency numbers</div>
      <div class="sfy-numgrid">
        ${numbers.map((n) => `
          <a class="sfy-numchip" href="${telHref(n.number)}">
            <span>${esc(n.label)}</span><strong>${esc(n.number || '—')}</strong>
          </a>`).join('')}
      </div>
    </div>` : '';

  const e = card.embassy;
  const embassyHtml = (e && (e.name || e.address || e.phone)) ? `
    <div class="sfy-sec">
      <div class="sfy-sec-title">🏛️ ${esc(e.nationality || 'Your')} embassy</div>
      <div class="sfy-embassy">
        ${e.name ? `<div class="sfy-embassy-name">${esc(e.name)}</div>` : ''}
        ${e.address ? `<div class="sfy-embassy-line">${esc(e.address)}</div>` : ''}
        ${e.phone ? `<a class="sfy-embassy-line sfy-link" href="${telHref(e.phone)}">${esc(e.phone)}</a>` : ''}
        ${e.website ? `<a class="sfy-embassy-line sfy-link" href="${esc(e.website)}" target="_blank" rel="noopener">${esc(e.website)}</a>` : ''}
      </div>
    </div>` : '';

  const hospitals = card.hospitals.filter((h) => h.name);
  const hospitalsHtml = hospitals.length ? `
    <div class="sfy-sec">
      <div class="sfy-sec-title">🏥 Hospitals & 24h pharmacies</div>
      ${hospitals.map((h) => `
        <div class="sfy-hospital">
          <div class="sfy-hospital-name">${esc(h.name)} ${h.is24h ? '<span class="sfy-tag-24h">24h</span>' : ''}</div>
          ${h.address ? `<div class="sfy-embassy-line">${esc(h.address)}</div>` : ''}
          ${h.phone ? `<a class="sfy-embassy-line sfy-link" href="${telHref(h.phone)}">${esc(h.phone)}</a>` : ''}
        </div>`).join('')}
    </div>` : '';

  const phrases = card.phrases.filter((ph) => ph.en);
  const phrasesHtml = phrases.length ? `
    <div class="sfy-sec">
      <div class="sfy-sec-title">💬 Emergency phrases</div>
      ${phrases.map((ph) => `
        <div class="sfy-phrase">
          <div class="sfy-phrase-en">${esc(ph.en)}</div>
          <div class="sfy-phrase-local">${esc(ph.local || '—')}${ph.pronunciation ? ` <span class="sfy-muted">/${esc(ph.pronunciation)}/</span>` : ''}</div>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="sfy-detail ${open ? 'open' : ''}" id="sfy-detail-${card.id}">
      <div class="sfy-detail-head">
        <div class="sfy-detail-flag">${card.flag || '🛡️'}</div>
        <div class="sfy-detail-title">
          <div class="sfy-detail-name">${esc(card.city)}</div>
          <div class="sfy-detail-country">${esc(card.country)} ${card.source === 'edited' ? '· <span class="sfy-muted">edited</span>' : ''}</div>
        </div>
        <div class="sfy-detail-actions">
          <button class="btn btn-ghost sfy-sm card-regen" data-id="${card.id}">Regenerate</button>
          <button class="btn btn-ghost sfy-sm card-close" data-id="${card.id}">Close</button>
          <button class="btn btn-danger sfy-sm card-delete" data-id="${card.id}">Delete</button>
        </div>
      </div>
      <div class="sfy-detail-grid">
        ${numbersHtml}
        ${embassyHtml}
        ${hospitalsHtml}
        ${listBlock('🚕', 'Trusted transport', card.trustedTransport)}
        ${listBlock('🚷', 'Areas / times to avoid', card.areasToAvoid)}
        ${listBlock('🎭', 'Common scams', card.commonScams)}
        ${phrasesHtml}
        ${listBlock('👜', 'For solo women here', card.womenTips)}
      </div>
      <div class="sfy-detail-foot">Updated ${new Date(card.updatedAt).toLocaleDateString()} · tap Regenerate to refresh, or your edits stay put.</div>
    </div>`;
}

/* Cities the user has covered, plus itinerary legs not yet generated. */
function renderCityCards(): string {
  const haveSlugs = new Set(_cards.map((c) => c.id));
  const pending = _legs
    .filter((l) => !haveSlugs.has(slugId(l.city)))
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const cardTiles = _cards.map((c) => `
    <div class="sfy-tile" data-id="${c.id}">
      <div class="sfy-tile-flag">${c.flag || '🛡️'}</div>
      <div class="sfy-tile-name">${esc(c.city)}</div>
      <div class="sfy-tile-country">${esc(c.country)}</div>
      <div class="sfy-tile-tags">
        <span>🚨</span><span>🏛️</span><span>🏥</span><span>💬</span>
      </div>
    </div>`).join('');

  const pendingTiles = pending.map((l) => `
    <div class="sfy-tile sfy-tile-pending" data-gen-city="${esc(l.city)}" data-gen-country="${esc(l.country)}" data-gen-flag="${esc(l.flag)}">
      <div class="sfy-tile-flag">${l.flag || '📍'}</div>
      <div class="sfy-tile-name">${esc(l.city)}</div>
      <div class="sfy-tile-country">${esc(l.country)}</div>
      <div class="sfy-tile-gen">+ Generate safety card</div>
    </div>`).join('');

  const empty = (!cardTiles && !pendingTiles)
    ? `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🛡️</div>
        <p>Add cities to your itinerary, or search one below, to build safety cards.</p></div>`
    : '';

  return cardTiles + pendingTiles + empty;
}

/* ── Essentials ─────────────────────────────────────────────────────────── */
function renderEssentials(): string {
  return ESSENTIALS.map((g) => `
    <div class="sfy-ess-card">
      <div class="sfy-ess-title">${g.icon} ${g.title}</div>
      <ul class="sfy-list">${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('');
}

/* ── Full render ────────────────────────────────────────────────────────── */
function render() {
  const root = document.getElementById('view-safety');
  if (!root) return;

  root.querySelector('.sfy-sos-wrap')!.innerHTML = renderSos();
  // While editing, leave the form DOM untouched so a background Firestore
  // snapshot can't wipe what the user is typing; only re-paint the read view.
  const profileWrap = root.querySelector('.sfy-profile-wrap')!;
  if (!editingProfile) {
    profileWrap.innerHTML = renderProfileView();
  } else if (!profileWrap.querySelector('#profile-form')) {
    profileWrap.innerHTML = renderProfileForm();
  }
  root.querySelector('.sfy-cities-detail')!.innerHTML = _cards.map(renderCardDetail).join('');
  root.querySelector('.sfy-cities-grid')!.innerHTML = renderCityCards();
  root.querySelector('.sfy-ess-grid')!.innerHTML = renderEssentials();

  wire(root);
}

let busyGenerating = false;

async function generateForCity(city: string, country: string) {
  if (busyGenerating || !city.trim()) return;
  busyGenerating = true;
  const status = document.getElementById('sfy-status')!;
  status.innerHTML = `<div class="sfy-loading"><span class="sfy-spinner"></span>Building safety card for ${esc(city)}…</div>`;

  const intel = await fetchCitySafety(city.trim(), country, _profile?.nationality ?? '');
  busyGenerating = false;

  if (!intel) {
    status.innerHTML = `<p class="sfy-err">Couldn't generate. Check your API key in .env</p>`;
    return;
  }
  status.innerHTML = '';
  const id = slugId(city);
  await safetyStore.save({ id, ...intel, source: 'ai' });
  openCardId = id;
}

function wire(root: HTMLElement) {
  root.querySelector('#sos-share')?.addEventListener('click', shareLocation);

  // Profile buttons: bind once per element (the form DOM persists across the
  // edit session, so re-running wire() must not stack duplicate listeners).
  const bindOnce = (sel: string, fn: () => void) => {
    const el = root.querySelector<HTMLElement>(sel);
    if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('click', fn); }
  };
  bindOnce('#profile-edit', () => { editingProfile = true; render(); });
  bindOnce('#profile-cancel', () => { editingProfile = false; render(); });
  bindOnce('#profile-save', () => { void saveProfile(); });

  // PDF file picker
  const pdfInput = root.querySelector<HTMLInputElement>('#pf-pdf-input');
  if (pdfInput && !pdfInput.dataset.wired) {
    pdfInput.dataset.wired = '1';
    pdfInput.addEventListener('change', () => {
      const file = pdfInput.files?.[0];
      const label = root.querySelector<HTMLElement>('#pf-pdf-label');
      if (label && file) label.textContent = `📎 ${file.name}`;
    });
  }

  root.querySelectorAll<HTMLElement>('.sfy-tile[data-id]').forEach((t) => {
    t.addEventListener('click', () => {
      const id = t.dataset.id!;
      openCardId = openCardId === id ? null : id;
      render();
      if (openCardId) document.getElementById(`sfy-detail-${openCardId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  root.querySelectorAll<HTMLElement>('.sfy-tile-pending').forEach((t) => {
    t.addEventListener('click', () => generateForCity(t.dataset.genCity!, t.dataset.genCountry ?? ''));
  });

  root.querySelectorAll<HTMLElement>('.card-close').forEach((b) =>
    b.addEventListener('click', () => { openCardId = null; render(); }));
  root.querySelectorAll<HTMLElement>('.card-delete').forEach((b) =>
    b.addEventListener('click', () => safetyStore.remove(b.dataset.id!)));
  root.querySelectorAll<HTMLElement>('.card-regen').forEach((b) =>
    b.addEventListener('click', () => {
      const card = _cards.find((c) => c.id === b.dataset.id);
      if (card) generateForCity(card.city, card.country);
    }));

  // Manual city search
  const input = root.querySelector<HTMLInputElement>('#sfy-search-input');
  const btn = root.querySelector<HTMLButtonElement>('#sfy-search-btn');
  if (input && btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    const go = () => { const q = input.value.trim(); if (q) { generateForCity(q, ''); input.value = ''; } };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
}

async function saveProfile() {
  const get = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)?.value.trim() ?? '';

  // Handle PDF upload if a new file was chosen
  const pdfInput = document.getElementById('pf-pdf-input') as HTMLInputElement | null;
  const pdfStatus = document.getElementById('pf-pdf-status');
  let pdfUrl = _profile?.insurancePdfUrl ?? '';
  let pdfName = _profile?.insurancePdfName ?? '';
  const file = pdfInput?.files?.[0];
  if (file) {
    if (pdfStatus) pdfStatus.textContent = 'Uploading…';
    try {
      const result = await uploadInsurancePdf(file);
      pdfUrl = result.url;
      pdfName = result.name;
      if (pdfStatus) pdfStatus.textContent = '✓ Uploaded';
    } catch {
      if (pdfStatus) pdfStatus.textContent = 'Upload failed';
    }
  }

  const contacts: SafetyProfile['emergencyContacts'] = [];
  if (get('pf-c0-name') || get('pf-c0-phone')) {
    contacts.push({
      name: get('pf-c0-name'),
      relation: get('pf-c0-rel'),
      dialCode: get('pf-c0-dial'),
      phone: get('pf-c0-phone'),
      isPrimary: true,
    });
  }
  if (get('pf-c1-name') || get('pf-c1-phone')) {
    contacts.push({
      name: get('pf-c1-name'),
      relation: '',
      dialCode: get('pf-c1-dial'),
      phone: get('pf-c1-phone'),
      isPrimary: false,
    });
  }

  await safetyProfileStore.save({
    nationality: get('pf-nat'),
    emergencyContacts: contacts,
    bloodType: get('pf-blood'),
    allergies: get('pf-allergy'),
    medications: get('pf-meds'),
    conditions: get('pf-cond'),
    insuranceProvider: get('pf-ins-prov'),
    insurancePolicy: get('pf-ins-policy'),
    insuranceHotline: get('pf-ins-hot'),
    insurancePdfUrl: pdfUrl,
    insurancePdfName: pdfName,
    notes: get('pf-notes'),
  });
  editingProfile = false;
}

async function shareLocation() {
  const btn = document.getElementById('sos-share') as HTMLButtonElement | null;
  if (!btn) return;
  if (!navigator.geolocation) { alert('Location not available on this device.'); return; }
  btn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const url = `https://maps.google.com/?q=${latitude},${longitude}`;
      const text = `📍 My location right now: ${url}`;
      try {
        if (navigator.share) await navigator.share({ title: 'My location', text, url });
        else { await navigator.clipboard.writeText(text); btn.textContent = '✓ Copied link'; }
      } catch { /* user dismissed */ }
      setTimeout(() => { btn.textContent = '📍 Share my location'; }, 2500);
    },
    () => { btn.textContent = 'Location blocked'; setTimeout(() => { btn.textContent = '📍 Share my location'; }, 2500); },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

export function initSafety() {
  const root = document.getElementById('view-safety')!;
  root.querySelector('.safety-body')!.innerHTML = `
    <div class="sfy-sos-wrap"></div>
    <div class="sfy-profile-wrap"></div>

    <div class="sfy-section-head">
      <h2>City safety</h2>
      <div class="sfy-search">
        <input class="input" id="sfy-search-input" placeholder="Search a city…">
        <button class="btn btn-primary sfy-sm" id="sfy-search-btn">Generate</button>
      </div>
    </div>
    <div id="sfy-status"></div>
    <div class="sfy-cities-detail"></div>
    <div class="sfy-cities-grid"></div>

    <div class="sfy-section-head"><h2>Before you go · solo & safe</h2></div>
    <div class="sfy-ess-grid"></div>
  `;

  // Idempotent: re-runs on trip switch, re-subscribing under the new tripId.
  // (safetyProfileStore is user-global, but re-subscribing is harmless.)
  _unsubProfile?.();
  _unsubLegs?.();
  _unsubCards?.();
  _cards = []; _legs = [];
  _unsubProfile = safetyProfileStore.subscribe((p) => { _profile = p; render(); });
  _unsubLegs = routeStore.subscribe((legs) => { _legs = legs; render(); });
  _unsubCards = safetyStore.subscribe((rows) => {
    _cards = [...rows].sort((a, b) => a.city.localeCompare(b.city));
    render();
  });
}
