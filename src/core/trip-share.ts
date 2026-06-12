/* ==========================================================================
   On the Road · Trip share modal + join flow
   --------------------------------------------------------------------------
   Owner-facing: create/copy an invite link, choose editor/viewer role, see
   and manage current members.
   Collaborator-facing: openJoinFromHash() handles #/join/{token} on boot.
   ========================================================================== */

import { openModal } from './modal.ts';
import { escHtml as esc } from './utils.ts';
import { currentUser } from '../firebase/auth.ts';
import { getTrip, tripMembers, removeMember } from '../data/trip-context.ts';
import {
  createInvite, listInvites, revokeInvite, inviteUrl, getInvite,
  addEmailInvite, removeEmailInvite,
} from '../data/trip-invites.ts';
import {
  listAccessRequests, approveAccessRequest, denyAccessRequest,
} from '../data/access-requests.ts';
import { shareablePages } from '../data/page-collections.ts';
import type { Trip } from '../data/schema.ts';

// Human labels for the shareable pages (mirror of the app shell's NAV_ITEMS,
// kept local so this module doesn't pull in the nav's icon assets).
const PAGE_LABELS: Record<string, string> = {
  route: 'Itinerary', prep: 'Checklist', pack: 'Pack', budget: 'Compare',
  cities: 'Guide', safety: 'Safety', expenses: 'Expenses', journal: 'Journal',
  map: 'Map', nomad: 'Nomad',
};
function pageLabel(id: string): string { return PAGE_LABELS[id] ?? id; }

/* ── Share modal (owner) ─────────────────────────────────────────────────── */

export async function openShareModal(tripId: string): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip) return;

  const m = openModal({
    title: `Share "${esc(trip.name)}"`,
    variant: 'modal',
    className: 'share-modal-wide',
    body: `<div id="share-body"><div class="share-loading">Loading…</div></div>`,
    footer: `<button class="btn btn-ghost" data-act="close">Done</button>`,
  });
  m.root.querySelector('[data-act="close"]')?.addEventListener('click', () => m.close());

  const body = m.root.querySelector<HTMLElement>('#share-body')!;
  const refresh = () => renderShareBody(body, tripId);
  await refresh();
}

async function renderShareBody(body: HTMLElement, tripId: string): Promise<void> {
  const [trip, members, invites, requests] = await Promise.all([
    getTrip(tripId),
    tripMembers(tripId),
    listInvites(tripId),
    listAccessRequests(tripId).catch(() => []),
  ]);
  const me = currentUser()?.uid;
  const amOwner = !!(me && members.find((x) => x.uid === me)?.role === 'owner');
  const emailInvites = (trip as Trip & { emailInvites?: Record<string, string> })?.emailInvites ?? {};
  const pendingEmails = Object.keys(emailInvites);

  const viewerInvites = invites.filter((i) => i.role === 'viewer');
  const editorInvites = invites.filter((i) => i.role === 'editor');
  const pages = shareablePages();

  const pageChips = (ids: string[]) => ids.length
    ? `<div class="share-link-pages">${ids.map((p) => `<span class="share-page-chip">${esc(pageLabel(p))}</span>`).join('')}</div>`
    : `<div class="share-link-pages"><span class="share-page-chip">All pages</span></div>`;

  // A reusable page-checkbox grid (all checked by default = full access).
  const pagePicker = (gridId: string) => `
    <div class="share-pages-grid" id="${gridId}">
      ${pages.map((p) => `
        <label class="share-page-check">
          <input type="checkbox" value="${esc(p)}" checked> ${esc(pageLabel(p))}
        </label>
      `).join('')}
    </div>`;

  const linkRow = (inv: { id: string; pages?: string[] }, icon: string) => `
    <div class="share-link-row share-link-row-stacked" data-token="${esc(inv.id)}">
      <div class="share-link-top">
        <span class="share-link-role">${icon}</span>
        <input class="input share-link-input" readonly value="${esc(inviteUrl(inv.id))}">
        <button class="btn btn-ghost pk-sm share-copy" data-token="${esc(inv.id)}">Copy</button>
        <button class="btn btn-ghost pk-sm share-revoke" data-token="${esc(inv.id)}" title="Revoke">✕</button>
      </div>
      ${pageChips(inv.pages ?? [])}
    </div>`;

  body.innerHTML = `
   <div class="share-grid">
    <div class="share-col">
      <div class="share-section">
        <div class="share-section-title">👁 View link — anyone with the link can view</div>
        <p class="share-hint">Pick which pages this link can see.</p>
        ${pagePicker('share-pages-view')}
        <button class="btn btn-primary share-gen-btn" id="share-gen-viewer">Create view link</button>
        <div id="share-viewer-links">
          ${viewerInvites.length ? viewerInvites.map((inv) => linkRow(inv, '👁 View')).join('') : '<p class="share-hint">No view link yet.</p>'}
        </div>
      </div>

      <div class="share-section">
        <div class="share-section-title">✉ Edit access — invite by email</div>
        <p class="share-hint">Enter the Google email the person signs in with. They get edit access on their next login. Choose which pages they can edit.</p>
        <div class="share-email-row">
          <input class="input share-email-input" id="share-email-input" type="email" placeholder="email@example.com">
          <button class="btn btn-primary" id="share-email-add">Invite</button>
        </div>
        ${pagePicker('share-pages-email')}
        <div id="share-email-list">
          ${pendingEmails.length ? pendingEmails.map((email) => `
            <div class="share-member-row">
              <span class="share-member-uid">${esc(email)}</span>
              <span class="share-member-role share-role-editor">editor (pending)</span>
              ${amOwner ? `<button class="btn btn-ghost pk-sm share-remove-email" data-email="${esc(email)}" title="Remove">Remove</button>` : ''}
            </div>
          `).join('') : ''}
        </div>
      </div>
    </div>

    <div class="share-col">
      <div class="share-section">
        <div class="share-section-title">✎ Edit link — requires login + your approval</div>
        <p class="share-hint">Opening this link asks you to approve the person. Pick which pages they can edit once approved.</p>
        ${pagePicker('share-pages-editlink')}
        <button class="btn btn-ghost share-gen-btn" id="share-gen-editor">Create edit link</button>
        <div id="share-editor-links">
          ${editorInvites.length ? editorInvites.map((inv) => linkRow(inv, '✎ Edit')).join('') : '<p class="share-hint">No edit link yet.</p>'}
        </div>
      </div>

      ${amOwner ? `
      <div class="share-section">
        <div class="share-section-title">
          Pending edit requests${requests.length ? ` <span class="share-badge">${requests.length}</span>` : ''}
        </div>
        <div id="share-requests">
          ${requests.length ? requests.map((r) => `
            <div class="share-request-row" data-req="${esc(r.id)}">
              <span class="share-member-uid">${esc(r.requesterName || r.requesterEmail || shortUid(r.requesterUid))}</span>
              <button class="btn btn-primary pk-sm share-approve" data-req="${esc(r.id)}">Approve</button>
              <button class="btn btn-ghost pk-sm share-deny" data-req="${esc(r.id)}">Deny</button>
            </div>
          `).join('') : '<p class="share-hint">No pending requests.</p>'}
        </div>
      </div>` : ''}

      <div class="share-section">
        <div class="share-section-title">Members (${members.length})</div>
        <div class="share-members">
          ${members.map((mem) => `
            <div class="share-member-row">
              <span class="share-member-uid">${esc(mem.uid === me ? 'You' : shortUid(mem.uid))}</span>
              <span class="share-member-role share-role-${mem.role}">${mem.role}</span>
              ${mem.role !== 'owner' && amOwner
                ? `<button class="btn btn-ghost pk-sm share-remove-member" data-uid="${esc(mem.uid)}" title="Remove">Remove</button>`
                : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
   </div>
  `;

  // Helper: read the checked page ids from a specific picker grid.
  const checkedPages = (gridId: string) => Array.from(
    body.querySelectorAll<HTMLInputElement>(`#${gridId} input[type="checkbox"]:checked`),
  ).map((c) => c.value);
  // If every page is checked, treat as "all pages" (store [] = full access).
  const scopeOrAll = (ids: string[]) => (ids.length === pages.length ? [] : ids);

  // Generate viewer invite link with the checked pages
  body.querySelector('#share-gen-viewer')?.addEventListener('click', async () => {
    const checked = checkedPages('share-pages-view');
    if (!checked.length) { alert('Pick at least one page to share.'); return; }
    try {
      await createInvite(tripId, 'viewer', scopeOrAll(checked));
      await renderShareBody(body, tripId);
    } catch (e) { alert('Could not create view link. ' + String(e)); }
  });

  // Generate editor invite link with the checked pages
  body.querySelector('#share-gen-editor')?.addEventListener('click', async () => {
    const checked = checkedPages('share-pages-editlink');
    if (!checked.length) { alert('Pick at least one page they can edit.'); return; }
    try {
      await createInvite(tripId, 'editor', scopeOrAll(checked));
      await renderShareBody(body, tripId);
    } catch (e) { alert('Could not create edit link. ' + String(e)); }
  });

  // Add email invite with the checked pages
  body.querySelector('#share-email-add')?.addEventListener('click', async () => {
    const input = body.querySelector<HTMLInputElement>('#share-email-input');
    const email = input?.value.trim() ?? '';
    if (!email) return;
    const checked = checkedPages('share-pages-email');
    if (!checked.length) { alert('Pick at least one page they can edit.'); return; }
    try {
      await addEmailInvite(tripId, email, scopeOrAll(checked));
      if (input) input.value = '';
      await renderShareBody(body, tripId);
    } catch (e) { alert('Could not add invite. ' + String(e)); }
  });

  // Remove email invite
  body.querySelectorAll<HTMLElement>('.share-remove-email').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await removeEmailInvite(tripId, btn.dataset.email!);
        await renderShareBody(body, tripId);
      } catch (e) { alert(String(e)); }
    });
  });

  // Approve / deny access requests
  body.querySelectorAll<HTMLElement>('.share-approve').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const req = requests.find((r) => r.id === btn.dataset.req);
      if (!req) return;
      try { await approveAccessRequest(req); await renderShareBody(body, tripId); }
      catch (e) { alert('Could not approve. ' + String(e)); }
    });
  });
  body.querySelectorAll<HTMLElement>('.share-deny').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const req = requests.find((r) => r.id === btn.dataset.req);
      if (!req) return;
      try { await denyAccessRequest(req); await renderShareBody(body, tripId); }
      catch (e) { alert('Could not deny. ' + String(e)); }
    });
  });

  // Copy link
  body.querySelectorAll<HTMLElement>('.share-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = inviteUrl(btn.dataset.token!);
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
      catch { /* clipboard blocked — input is selectable as fallback */ }
    });
  });

  // Revoke link
  body.querySelectorAll<HTMLElement>('.share-revoke').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this invite link?')) return;
      await revokeInvite(btn.dataset.token!);
      await renderShareBody(body, tripId);
    });
  });

  // Remove member
  body.querySelectorAll<HTMLElement>('.share-remove-member').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this member from the trip?')) return;
      try { await removeMember(tripId, btn.dataset.uid!); await renderShareBody(body, tripId); }
      catch (e) { alert(String(e)); }
    });
  });
}

function shortUid(uid: string): string {
  return uid.slice(0, 6) + '…';
}

/* ── Join flow (collaborator) ────────────────────────────────────────────── */

// Editor links no longer auto-grant access. An editor link opening for a
// signed-in non-member submits an access request that the owner approves
// in-app. This key stashes the editor token across the Google sign-in
// round-trip so the request can be created once the user is authenticated.
const PENDING_ACCESS_KEY = 'otr_pending_access_request';

/** Extract a join token from the current hash (does not clear it). */
export function joinTokenFromHash(): string | null {
  const match = window.location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/** Stash an editor token so it survives a sign-in redirect / page reload. */
export function savePendingAccessRequest(token: string): void {
  sessionStorage.setItem(PENDING_ACCESS_KEY, token);
}

function consumeStoredAccessToken(): string | null {
  const t = sessionStorage.getItem(PENDING_ACCESS_KEY);
  if (t) sessionStorage.removeItem(PENDING_ACCESS_KEY);
  return t;
}

/**
 * Submit an edit-access request for an editor invite token. Returns true if a
 * request was created (or already existed). The caller is responsible for
 * showing the "request sent" UI. No-ops to false if the user is already a
 * member (caller should boot normally instead).
 */
export async function submitAccessRequest(token: string): Promise<boolean> {
  const invite = await getInvite(token);
  if (!invite || invite.revoked || invite.role !== 'editor') return false;
  const { createAccessRequest } = await import('../data/access-requests.ts');
  const id = await createAccessRequest(invite.tripId, invite.pages ?? []);
  return id !== null;
}

/**
 * After a successful Google sign-in, if an editor token was stashed, create the
 * access request now. Returns true if a request was created. Call once the
 * authenticated shell has booted.
 */
export async function consumePendingAccessRequest(): Promise<boolean> {
  const token = consumeStoredAccessToken();
  if (!token || !currentUser()) return false;
  return submitAccessRequest(token);
}
