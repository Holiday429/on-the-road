/* ==========================================================================
   On the Road · Profile — "Me"
   --------------------------------------------------------------------------
   Who the traveller is: the photo, the name they travel under, their
   nationality. It is the same record the passport's data page shows
   (users/{uid}/passport/me), so editing it here changes it there and the other
   way round — one identity, two places to look at it. Editing opens the
   passport's own editor rather than a second form.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { currentUser } from '../../firebase/auth.ts';
import { passportStore } from '../../data/stores/passport-store.ts';
import { safetyProfileStore } from '../../data/stores/safety-profile-store.ts';
import { nationalityFlag, nationalityLabel } from '../../data/nationalities.ts';
import { openBioEditor } from '../passport/bio-edit.ts';

/** The name to travel under when nothing has been typed: the account's first name. */
export function defaultNickname(): string {
  const u = currentUser();
  return (u?.displayName?.trim().split(/\s+/)[0]) || (u?.email?.trim().split('@')[0]) || t('passport.bio.traveller');
}

export function renderMeSection(): string {
  const p = passportStore.peek();
  const u = currentUser();
  const nickname = p?.nickname?.trim() || defaultNickname();
  const photo = p?.photoURL?.trim() || u?.photoURL?.trim() || '';
  // Nationality falls back to the safety profile's, which is where it was first asked for.
  const nat = p?.nationality?.trim() || safetyProfileStore.peek()?.nationality?.trim() || '';
  const occupation = p?.occupation?.trim() || t('passport.bio.traveller');

  const face = photo
    ? `<img class="profile-me-photo" src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="profile-me-photo profile-me-photo--blank" aria-hidden="true">🙂</div>`;
  const natLine = nat
    ? `${nationalityFlag(nat)} ${esc(nationalityLabel(nat))}`
    : `<span class="profile-muted">${esc(t('profile.me.noNationality'))}</span>`;

  return `
    <div class="profile-me">
      ${face}
      <div class="profile-me-text">
        <div class="profile-me-name">${esc(nickname)}</div>
        <div class="profile-me-meta">${esc(occupation)}</div>
        <div class="profile-me-meta">${natLine}</div>
      </div>
      <button type="button" class="btn btn-ghost" data-me-edit>${esc(t('common.edit'))}</button>
    </div>
    <p class="profile-me-note">${esc(t('profile.me.shared'))}</p>`;
}

/** Wires the edit button; `onChanged` repaints the section after a save. */
export function wireMeSection(root: HTMLElement, onChanged: () => void): void {
  root.querySelector<HTMLElement>('[data-me-edit]')?.addEventListener('click', () => {
    const nat = safetyProfileStore.peek()?.nationality ?? '';
    openBioEditor({ nickname: defaultNickname(), nationality: nat }, onChanged);
  });
}

/** Repaints whenever the shared identity changes (e.g. edited in the passport). */
export function subscribeMeSection(onChange: () => void): () => void {
  return passportStore.subscribe(() => onChange());
}
