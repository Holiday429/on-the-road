/* ==========================================================================
   On the Road · Profile — emergency card section (view + edit)
   Ported from views/safety/profile-sheet.ts, which was a self-attached
   overlay sheet; here it's an inline section painted into the Profile page's
   own container instead of document.body. Upload-then-save ordering is
   unchanged: files upload first, URLs are awaited, then Firestore is written.
   ========================================================================== */

import { safetyProfileStore, type StoredSafetyProfile } from '../../data/stores/safety-profile-store.ts';
import { uploadSafetyDoc } from '../../firebase/storage.ts';
import { NATIONALITIES, DIAL_CODES, nationalityFlag, nationalityLabel } from '../../data/nationalities.ts';
import type { SafetyProfile } from '../../data/schema.ts';
import { t } from '../../core/i18n.ts';
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
  return `<div class="profile-phone-row">
    <select class="input select profile-dial-select" id="${dialId}">${dialOptions(dialVal)}</select>
    <input class="input profile-phone-local" id="${localId}" type="tel" value="${esc(localVal)}" placeholder="number">
  </div>`;
}

function field(id: string, val: string, ph: string, label: string, type = 'text'): string {
  return `<div class="profile-field">
    <label class="field-label" for="${id}">${label}</label>
    <input class="input" id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}">
  </div>`;
}

function docUploadRow(inputId: string, labelId: string, statusId: string, currentUrl: string, currentName: string, label: string): string {
  const existing = currentUrl
    ? `<a class="profile-doc-link" href="${esc(currentUrl)}" target="_blank" rel="noopener">📄 ${esc(currentName || 'View file')}</a>`
    : '';
  return `<div class="profile-field">
    <label class="field-label">${label}</label>
    ${existing}
    <div class="profile-upload-row">
      <label class="profile-upload-btn" for="${inputId}">
        <span id="${labelId}">📎 ${currentUrl ? 'Replace…' : 'Upload…'}</span>
        <input type="file" id="${inputId}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" style="display:none">
      </label>
      <span class="profile-upload-status" id="${statusId}"></span>
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
      <div class="profile-emergency-empty">
        <div class="profile-emergency-empty-icon">🆘</div>
        <p>${t('safety.emptyHint')}<br>${t('safety.emptyHint2')}</p>
        <button class="btn btn-primary" id="pfe-edit">${t('safety.btnSetup')}</button>
      </div>`;
  }

  const primary = p!.emergencyContacts?.find((c) => c.isPrimary) ?? p!.emergencyContacts?.[0];

  const contacts = (p!.emergencyContacts ?? []).map((c) => {
    const phone = fullPhone(c.dialCode, c.phone);
    return `<a class="profile-contact" href="${phone ? telHref(c.dialCode, c.phone) : '#'}">
      <span class="profile-contact-name">${esc(c.name)}${c.relation ? ` · ${esc(c.relation)}` : ''}${c.isPrimary ? ' ⭐' : ''}</span>
      <span class="profile-contact-phone">${esc(phone || '—')}</span>
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
    `<div class="profile-fact"><span class="profile-fact-k">${k}</span><span class="profile-fact-v">${esc(v)}</span></div>`,
  ).join('');

  const docs = [
    p!.insurancePdfUrl && `<a class="profile-doc-link" href="${esc(p!.insurancePdfUrl)}" target="_blank" rel="noopener">📄 ${esc(p!.insurancePdfName || 'Insurance PDF')}</a>`,
    p!.medicalDocUrl && `<a class="profile-doc-link" href="${esc(p!.medicalDocUrl)}" target="_blank" rel="noopener">🩺 ${esc(p!.medicalDocName || 'Medical card')}</a>`,
  ].filter(Boolean).join('');

  return `
    <div class="profile-emergency-view">
      <div class="profile-emergency-grid">
        ${p!.nationality ? `<div class="profile-emergency-block">
          <div class="profile-emergency-block-label">${t('safety.labelNationality')}</div>
          <div class="profile-nat">${nationalityFlag(p!.nationality)} ${esc(nationalityLabel(p!.nationality))}</div>
        </div>` : ''}
        ${contacts ? `<div class="profile-emergency-block">
          <div class="profile-emergency-block-label">${t('safety.labelEmergency')}</div>
          ${contacts}
        </div>` : ''}
        ${medRows.length ? `<div class="profile-emergency-block">
          <div class="profile-emergency-block-label">${t('safety.labelMedical')}</div>
          ${facts(medRows)}
        </div>` : ''}
        ${(insRows.length || docs) ? `<div class="profile-emergency-block">
          <div class="profile-emergency-block-label">${t('safety.labelInsurance')}</div>
          ${facts(insRows)}
          ${docs}
        </div>` : ''}
      </div>
      ${p!.notes ? `<div class="profile-emergency-notes">${esc(p!.notes)}</div>` : ''}
      ${primary ? `<a class="btn btn-primary profile-emergency-call" href="${telHref(primary.dialCode, primary.phone)}">
        📞 Call ${esc(primary.name || 'emergency contact')}
      </a>` : ''}
      <button class="btn btn-ghost profile-emergency-edit-btn" id="pfe-edit">Edit</button>
    </div>`;
}

/* ── Edit mode ────────────────────────────────────────────────────────────── */
function renderForm(p: StoredSafetyProfile | null): string {
  const c0 = p?.emergencyContacts?.[0] ?? { name: '', relation: '', dialCode: '', phone: '', isPrimary: true };
  const c1 = p?.emergencyContacts?.[1] ?? { name: '', relation: '', dialCode: '', phone: '', isPrimary: false };

  return `
    <form class="profile-emergency-form" id="pfe-form" autocomplete="off">
      <div class="profile-emergency-form-grid">

        <div class="profile-emergency-form-col">
          <div class="profile-emergency-col-head">${t('safety.formPersonal')}</div>
          <div class="profile-field">
            <label class="field-label" for="pfn-nat">${t('safety.labelNationality')} <span class="profile-muted">${t('safety.nationalityHint')}</span></label>
            <select class="input select" id="pfn-nat">${natOptions(p?.nationality ?? '')}</select>
          </div>
          ${field('pfn-blood', p?.bloodType ?? '', 'e.g. O+', 'Blood type')}
          ${field('pfn-allergy', p?.allergies ?? '', 'penicillin, nuts…', 'Allergies')}
          ${field('pfn-meds', p?.medications ?? '', 'anything you take regularly', 'Medications')}
          ${field('pfn-cond', p?.conditions ?? '', 'asthma, diabetes…', 'Conditions')}
        </div>

        <div class="profile-emergency-form-col">
          <div class="profile-emergency-col-head">${t('safety.contact1Label')}</div>
          ${field('pfn-c0-name', c0.name, 'Name', 'Name')}
          ${field('pfn-c0-rel', c0.relation, 'mum / partner / friend', 'Relation')}
          <div class="profile-field">
            <label class="field-label">Phone</label>
            ${phoneRow('pfn-c0-dial', 'pfn-c0-phone', c0.dialCode, c0.phone)}
          </div>
          <div class="profile-emergency-col-head" style="margin-top:var(--sp-4)">${t('safety.contact2Label')}</div>
          ${field('pfn-c1-name', c1.name, 'Name', 'Name')}
          <div class="profile-field">
            <label class="field-label">Phone</label>
            ${phoneRow('pfn-c1-dial', 'pfn-c1-phone', c1.dialCode, c1.phone)}
          </div>
        </div>

        <div class="profile-emergency-form-col">
          <div class="profile-emergency-col-head">${t('safety.insuranceSection')}</div>
          ${field('pfn-ins-prov', p?.insuranceProvider ?? '', 'insurer name', 'Travel insurer')}
          ${field('pfn-ins-pol', p?.insurancePolicy ?? '', 'policy number', 'Policy number')}
          ${field('pfn-ins-hot', p?.insuranceHotline ?? '', '24h assistance line', 'Insurance hotline')}
          ${docUploadRow('pfn-ins-file', 'pfn-ins-label', 'pfn-ins-status',
            p?.insurancePdfUrl ?? '', p?.insurancePdfName ?? '', 'Insurance policy PDF')}

          <div class="profile-emergency-col-head" style="margin-top:var(--sp-4)">${t('safety.medicalDocSection')}</div>
          ${docUploadRow('pfn-med-file', 'pfn-med-label', 'pfn-med-status',
            p?.medicalDocUrl ?? '', p?.medicalDocName ?? '', 'Medical card or summary')}

          <div class="profile-field">
            <label class="field-label" for="pfn-notes">${t('safety.notesForMedics')}</label>
            <textarea class="input" id="pfn-notes" rows="3" placeholder="anything a first responder should know">${esc(p?.notes ?? '')}</textarea>
          </div>
        </div>

      </div>

      <div class="profile-emergency-form-actions">
        <button type="button" class="btn btn-ghost" id="pfe-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="pfe-save">Save</button>
      </div>
    </form>`;
}

/* ── Public API — inline section, not a self-attached overlay ────────────── */

let _editing = false;
let _profile: StoredSafetyProfile | null = null;
let _host: HTMLElement | null = null;

export function renderEmergencySection(): string {
  return `<div id="pfe-body">${_editing ? renderForm(_profile) : renderView(_profile)}</div>`;
}

function repaint(): void {
  const body = _host?.querySelector<HTMLElement>('#pfe-body');
  if (!body) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  body.innerHTML = _editing ? renderForm(_profile) : renderView(_profile);
  wireEmergencySection(_host!);
}

export function wireEmergencySection(host: HTMLElement): void {
  _host = host;

  host.querySelector('#pfe-edit')?.addEventListener('click', () => { _editing = true; repaint(); });
  host.querySelector('#pfe-cancel')?.addEventListener('click', () => { _editing = false; repaint(); });

  const wirePicker = (inputId: string, labelId: string) => {
    const input = host.querySelector<HTMLInputElement>(`#${inputId}`);
    const label = host.querySelector<HTMLElement>(`#${labelId}`);
    if (input && label) {
      input.addEventListener('change', () => {
        if (input.files?.[0]) label.textContent = `📎 ${input.files[0].name}`;
      });
    }
  };
  wirePicker('pfn-ins-file', 'pfn-ins-label');
  wirePicker('pfn-med-file', 'pfn-med-label');

  host.querySelector<HTMLFormElement>('#pfe-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void saveProfile();
  });
}

async function saveProfile() {
  const get = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)
      ?.value.trim() ?? '';

  const saveBtn = document.getElementById('pfe-save') as HTMLButtonElement | null;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

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
        if (insStatus) insStatus.textContent = t('safety.uploadFailed');
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
        if (medStatus) medStatus.textContent = t('safety.uploadFailed');
      }),
    );
  }

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
  // repaint() runs from the store subscriber below once Firestore updates.
}

/** Subscribe to live profile updates; call once from the Profile page's init.
 *  Returns an unsubscribe fn. */
export function subscribeEmergencySection(onChange: () => void): () => void {
  return safetyProfileStore.subscribe((p) => {
    _profile = p;
    if (!_editing) onChange();
  });
}
