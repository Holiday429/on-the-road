/* ==========================================================================
   On the Road · Safety profile sheet — emergency card drawer (view + edit)
   Fixed PDF/medical upload: upload first, await URL, then save to Firestore.
   ========================================================================== */

import { safetyProfileStore, type StoredSafetyProfile } from '../../data/stores/safety-profile-store.ts';
import { uploadSafetyDoc } from '../../firebase/storage.ts';
import { NATIONALITIES, DIAL_CODES, nationalityFlag, nationalityLabel } from '../../data/nationalities.ts';
import type { SafetyProfile } from '../../data/schema.ts';
import { escHtml as esc } from '../../core/utils.ts';

function telHref(dialCode: string, local: string): string {
  const raw = `${dialCode}${local}`;
  return `tel:${raw.replace(/[^+0-9]/g, '')}`;
}

function fullPhone(dialCode: string, local: string): string {
  if (!dialCode && !local) return '';
  return `${dialCode} ${local}`.trim();
}

function natOptions(selected: string): string {
  const blank = `<option value="" ${selected ? '' : 'selected'}>Select nationality…</option>`;
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

function phoneRow(dialId: string, localId: string, dialVal: string, localVal: string): string {
  return `<div class="sfy-phone-row">
    <select class="input select sfy-dial-select" id="${dialId}">${dialOptions(dialVal)}</select>
    <input class="input sfy-phone-local" id="${localId}" type="tel" value="${esc(localVal)}" placeholder="number">
  </div>`;
}

function field(id: string, val: string, ph: string, label: string, type = 'text'): string {
  return `<div class="sfy-field">
    <label class="field-label" for="${id}">${label}</label>
    <input class="input" id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}">
  </div>`;
}

function docUploadRow(inputId: string, labelId: string, statusId: string, currentUrl: string, currentName: string, label: string): string {
  const existing = currentUrl
    ? `<a class="sfy-doc-link" href="${esc(currentUrl)}" target="_blank" rel="noopener">📄 ${esc(currentName || 'View file')}</a>`
    : '';
  return `<div class="sfy-field">
    <label class="field-label">${label}</label>
    ${existing}
    <div class="sfy-upload-row">
      <label class="sfy-upload-btn" for="${inputId}">
        <span id="${labelId}">📎 ${currentUrl ? 'Replace…' : 'Upload…'}</span>
        <input type="file" id="${inputId}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" style="display:none">
      </label>
      <span class="sfy-upload-status" id="${statusId}"></span>
    </div>
  </div>`;
}

/* ── View mode ────────────────────────────────────────────────────────────── */
function renderView(p: StoredSafetyProfile | null): string {
  const hasAny = !!p && (
    p.nationality || (p.emergencyContacts?.length ?? 0) > 0 ||
    p.bloodType || p.allergies || p.medications || p.insurancePolicy
  );

  if (!hasAny) {
    return `
      <div class="sfyp-empty">
        <div class="sfyp-empty-icon">🆘</div>
        <p>Add your nationality, emergency contact, blood type and insurance.<br>
        Kept private on your account — ready to show a medic or consulate.</p>
        <button class="btn btn-primary" id="sfyp-edit">Set up my card</button>
      </div>`;
  }

  const primary = p!.emergencyContacts?.find((c) => c.isPrimary) ?? p!.emergencyContacts?.[0];

  const contacts = (p!.emergencyContacts ?? []).map((c) => {
    const phone = fullPhone(c.dialCode, c.phone);
    return `<a class="sfyp-contact" href="${phone ? telHref(c.dialCode, c.phone) : '#'}">
      <span class="sfyp-contact-name">${esc(c.name)}${c.relation ? ` · ${esc(c.relation)}` : ''}${c.isPrimary ? ' ⭐' : ''}</span>
      <span class="sfyp-contact-phone">${esc(phone || '—')}</span>
    </a>`;
  }).join('');

  const medRows = [
    p!.bloodType && ['Blood type', p!.bloodType],
    p!.allergies && ['Allergies', p!.allergies],
    p!.medications && ['Medications', p!.medications],
    p!.conditions && ['Conditions', p!.conditions],
  ].filter(Boolean) as [string, string][];

  const insRows = [
    p!.insuranceProvider && ['Insurer', p!.insuranceProvider],
    p!.insurancePolicy && ['Policy', p!.insurancePolicy],
    p!.insuranceHotline && ['Hotline', p!.insuranceHotline],
  ].filter(Boolean) as [string, string][];

  const facts = (rows: [string, string][]) => rows.map(([k, v]) =>
    `<div class="sfyp-fact"><span class="sfyp-fact-k">${k}</span><span class="sfyp-fact-v">${esc(v)}</span></div>`,
  ).join('');

  const docs = [
    p!.insurancePdfUrl && `<a class="sfy-doc-link" href="${esc(p!.insurancePdfUrl)}" target="_blank" rel="noopener">📄 ${esc(p!.insurancePdfName || 'Insurance PDF')}</a>`,
    p!.medicalDocUrl && `<a class="sfy-doc-link" href="${esc(p!.medicalDocUrl)}" target="_blank" rel="noopener">🩺 ${esc(p!.medicalDocName || 'Medical card')}</a>`,
  ].filter(Boolean).join('');

  return `
    <div class="sfyp-view">
      <div class="sfyp-grid">
        ${p!.nationality ? `<div class="sfyp-block">
          <div class="sfyp-block-label">Nationality</div>
          <div class="sfyp-nat">${nationalityFlag(p!.nationality)} ${esc(nationalityLabel(p!.nationality))}</div>
        </div>` : ''}
        ${contacts ? `<div class="sfyp-block">
          <div class="sfyp-block-label">Emergency contacts</div>
          ${contacts}
        </div>` : ''}
        ${medRows.length ? `<div class="sfyp-block">
          <div class="sfyp-block-label">Medical</div>
          ${facts(medRows)}
        </div>` : ''}
        ${(insRows.length || docs) ? `<div class="sfyp-block">
          <div class="sfyp-block-label">Insurance &amp; documents</div>
          ${facts(insRows)}
          ${docs}
        </div>` : ''}
      </div>
      ${p!.notes ? `<div class="sfyp-notes">${esc(p!.notes)}</div>` : ''}
      ${primary ? `<a class="btn btn-primary sfyp-call" href="${telHref(primary.dialCode, primary.phone)}">
        📞 Call ${esc(primary.name || 'emergency contact')}
      </a>` : ''}
      <button class="btn btn-ghost sfyp-edit-btn" id="sfyp-edit">Edit</button>
    </div>`;
}

/* ── Edit mode ────────────────────────────────────────────────────────────── */
function renderForm(p: StoredSafetyProfile | null): string {
  const c0 = p?.emergencyContacts?.[0] ?? { name: '', relation: '', dialCode: '', phone: '', isPrimary: true };
  const c1 = p?.emergencyContacts?.[1] ?? { name: '', relation: '', dialCode: '', phone: '', isPrimary: false };

  return `
    <form class="sfyp-form" id="sfyp-form" autocomplete="off">
      <div class="sfyp-form-grid">

        <div class="sfyp-form-col">
          <div class="sfyp-col-head">Personal</div>
          <div class="sfy-field">
            <label class="field-label" for="pfn-nat">Nationality <span class="sfy-muted">(picks your embassy)</span></label>
            <select class="input select" id="pfn-nat">${natOptions(p?.nationality ?? '')}</select>
          </div>
          ${field('pfn-blood', p?.bloodType ?? '', 'e.g. O+', 'Blood type')}
          ${field('pfn-allergy', p?.allergies ?? '', 'penicillin, nuts…', 'Allergies')}
          ${field('pfn-meds', p?.medications ?? '', 'anything you take regularly', 'Medications')}
          ${field('pfn-cond', p?.conditions ?? '', 'asthma, diabetes…', 'Conditions')}
        </div>

        <div class="sfyp-form-col">
          <div class="sfyp-col-head">Emergency contact 1 ⭐</div>
          ${field('pfn-c0-name', c0.name, 'Name', 'Name')}
          ${field('pfn-c0-rel', c0.relation, 'mum / partner / friend', 'Relation')}
          <div class="sfy-field">
            <label class="field-label">Phone</label>
            ${phoneRow('pfn-c0-dial', 'pfn-c0-phone', c0.dialCode, c0.phone)}
          </div>
          <div class="sfyp-col-head" style="margin-top:var(--sp-4)">Emergency contact 2</div>
          ${field('pfn-c1-name', c1.name, 'Name', 'Name')}
          <div class="sfy-field">
            <label class="field-label">Phone</label>
            ${phoneRow('pfn-c1-dial', 'pfn-c1-phone', c1.dialCode, c1.phone)}
          </div>
        </div>

        <div class="sfyp-form-col">
          <div class="sfyp-col-head">Insurance</div>
          ${field('pfn-ins-prov', p?.insuranceProvider ?? '', 'insurer name', 'Travel insurer')}
          ${field('pfn-ins-pol', p?.insurancePolicy ?? '', 'policy number', 'Policy number')}
          ${field('pfn-ins-hot', p?.insuranceHotline ?? '', '24h assistance line', 'Insurance hotline')}
          ${docUploadRow('pfn-ins-file', 'pfn-ins-label', 'pfn-ins-status',
            p?.insurancePdfUrl ?? '', p?.insurancePdfName ?? '', 'Insurance policy PDF')}

          <div class="sfyp-col-head" style="margin-top:var(--sp-4)">Medical card / documents</div>
          ${docUploadRow('pfn-med-file', 'pfn-med-label', 'pfn-med-status',
            p?.medicalDocUrl ?? '', p?.medicalDocName ?? '', 'Medical card or summary')}

          <div class="sfy-field">
            <label class="field-label" for="pfn-notes">Notes for medics</label>
            <textarea class="input" id="pfn-notes" rows="3" placeholder="anything a first responder should know">${esc(p?.notes ?? '')}</textarea>
          </div>
        </div>

      </div>

      <div class="sfyp-form-actions">
        <button type="button" class="btn btn-ghost sfy-sm" id="sfyp-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary sfy-sm" id="sfyp-save">Save</button>
      </div>
    </form>`;
}

/* ── Sheet shell ──────────────────────────────────────────────────────────── */
function createSheetDOM(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'sfy-profile-sheet';
  el.className = 'sfy-sheet-overlay';
  el.innerHTML = `
    <div class="sfy-sheet" role="dialog" aria-modal="true">
      <div class="sfy-sheet-header">
        <div class="sfy-sheet-title">🆘 My emergency card</div>
        <button class="sfy-sheet-close" id="sfyp-close" aria-label="Close">×</button>
      </div>
      <div class="sfy-sheet-body" id="sfyp-body"></div>
    </div>`;
  return el;
}

/* ── Public API ───────────────────────────────────────────────────────────── */

let _sheet: HTMLElement | null = null;
let _editing = false;
let _profile: StoredSafetyProfile | null = null;
let _unsub: (() => void) | null = null;

function bodyEl(): HTMLElement | null {
  return document.getElementById('sfyp-body');
}

function paint() {
  const body = bodyEl();
  if (!body) return;
  body.innerHTML = _editing ? renderForm(_profile) : renderView(_profile);
  wireSheet();
}

function wireSheet() {
  const sheet = _sheet;
  if (!sheet) return;

  sheet.querySelector('#sfyp-close')?.addEventListener('click', closeProfileSheet);

  sheet.querySelector('#sfyp-edit')?.addEventListener('click', () => {
    _editing = true;
    paint();
  });
  sheet.querySelector('#sfyp-cancel')?.addEventListener('click', () => {
    _editing = false;
    paint();
  });

  // File picker label updates
  const wirePicker = (inputId: string, labelId: string) => {
    const input = sheet.querySelector<HTMLInputElement>(`#${inputId}`);
    const label = sheet.querySelector<HTMLElement>(`#${labelId}`);
    if (input && label) {
      input.addEventListener('change', () => {
        if (input.files?.[0]) label.textContent = `📎 ${input.files[0].name}`;
      });
    }
  };
  wirePicker('pfn-ins-file', 'pfn-ins-label');
  wirePicker('pfn-med-file', 'pfn-med-label');

  const form = sheet.querySelector<HTMLFormElement>('#sfyp-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void saveProfile();
    });
  }
}

async function saveProfile() {
  const get = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)
      ?.value.trim() ?? '';

  const saveBtn = document.getElementById('sfyp-save') as HTMLButtonElement | null;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  // ── Upload documents first, await URLs before writing Firestore ────────────
  let insurancePdfUrl = _profile?.insurancePdfUrl ?? '';
  let insurancePdfName = _profile?.insurancePdfName ?? '';
  let medicalDocUrl = _profile?.medicalDocUrl ?? '';
  let medicalDocName = _profile?.medicalDocName ?? '';

  const insFile = (document.getElementById('pfn-ins-file') as HTMLInputElement | null)?.files?.[0];
  const medFile = (document.getElementById('pfn-med-file') as HTMLInputElement | null)?.files?.[0];
  const insStatus = document.getElementById('pfn-ins-status');
  const medStatus = document.getElementById('pfn-med-status');

  const uploads: Promise<void>[] = [];

  if (insFile) {
    if (insStatus) insStatus.textContent = 'Uploading…';
    uploads.push(
      uploadSafetyDoc(insFile, 'insurance').then((r) => {
        insurancePdfUrl = r.url;
        insurancePdfName = r.name;
        if (insStatus) insStatus.textContent = '✓ Uploaded';
      }).catch(() => {
        if (insStatus) insStatus.textContent = '✗ Upload failed';
      }),
    );
  }

  if (medFile) {
    if (medStatus) medStatus.textContent = 'Uploading…';
    uploads.push(
      uploadSafetyDoc(medFile, 'medical').then((r) => {
        medicalDocUrl = r.url;
        medicalDocName = r.name;
        if (medStatus) medStatus.textContent = '✓ Uploaded';
      }).catch(() => {
        if (medStatus) medStatus.textContent = '✗ Upload failed';
      }),
    );
  }

  // Wait for all uploads to finish before writing to Firestore
  await Promise.all(uploads);

  const contacts: SafetyProfile['emergencyContacts'] = [];
  if (get('pfn-c0-name') || get('pfn-c0-phone')) {
    contacts.push({
      name: get('pfn-c0-name'),
      relation: get('pfn-c0-rel'),
      dialCode: get('pfn-c0-dial'),
      phone: get('pfn-c0-phone'),
      isPrimary: true,
    });
  }
  if (get('pfn-c1-name') || get('pfn-c1-phone')) {
    contacts.push({
      name: get('pfn-c1-name'),
      relation: '',
      dialCode: get('pfn-c1-dial'),
      phone: get('pfn-c1-phone'),
      isPrimary: false,
    });
  }

  await safetyProfileStore.save({
    nationality: get('pfn-nat'),
    emergencyContacts: contacts,
    bloodType: get('pfn-blood'),
    allergies: get('pfn-allergy'),
    medications: get('pfn-meds'),
    conditions: get('pfn-cond'),
    insuranceProvider: get('pfn-ins-prov'),
    insurancePolicy: get('pfn-ins-pol'),
    insuranceHotline: get('pfn-ins-hot'),
    insurancePdfUrl,
    insurancePdfName,
    medicalDocUrl,
    medicalDocName,
    notes: get('pfn-notes'),
  });

  _editing = false;
  // paint() will be called by the store subscriber when Firestore updates
}

export function openProfileSheet(): void {
  if (_sheet) return;

  _sheet = createSheetDOM();
  document.body.appendChild(_sheet);

  _editing = false;

  // Subscribe to live profile updates
  _unsub = safetyProfileStore.subscribe((p) => {
    _profile = p;
    if (!_editing) paint(); // don't overwrite form while user is editing
  });

  // Close on overlay click
  _sheet.addEventListener('click', (e) => { if (e.target === _sheet) closeProfileSheet(); });

  // Esc key
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closeProfileSheet(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  paint();
}

export function closeProfileSheet(): void {
  _unsub?.();
  _unsub = null;
  _sheet?.remove();
  _sheet = null;
  _editing = false;
}
