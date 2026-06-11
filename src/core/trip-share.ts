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
import { getTrip, tripMembers, removeMember, switchTrip } from '../data/trip-context.ts';
import {
  createInvite, listInvites, revokeInvite, acceptInvite, inviteUrl, getInvite,
  addEmailInvite, removeEmailInvite,
} from '../data/trip-invites.ts';
import type { Trip } from '../data/schema.ts';

/* ── Share modal (owner) ─────────────────────────────────────────────────── */

export async function openShareModal(tripId: string): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip) return;

  const m = openModal({
    title: `Share "${esc(trip.name)}"`,
    variant: 'sheet',
    body: `<div id="share-body"><div class="share-loading">Loading…</div></div>`,
    footer: `<button class="btn btn-ghost" data-act="close">Done</button>`,
  });
  m.root.querySelector('[data-act="close"]')?.addEventListener('click', () => m.close());

  const body = m.root.querySelector<HTMLElement>('#share-body')!;
  const refresh = () => renderShareBody(body, tripId);
  await refresh();
}

async function renderShareBody(body: HTMLElement, tripId: string): Promise<void> {
  const [trip, members, invites] = await Promise.all([
    getTrip(tripId),
    tripMembers(tripId),
    listInvites(tripId),
  ]);
  const me = currentUser()?.uid;
  const amOwner = !!(me && members.find((x) => x.uid === me)?.role === 'owner');
  const emailInvites = (trip as Trip & { emailInvites?: Record<string, string> })?.emailInvites ?? {};
  const pendingEmails = Object.keys(emailInvites);

  const viewerInvites = invites.filter((i) => i.role === 'viewer');
  const editorInvites = invites.filter((i) => i.role === 'editor');

  body.innerHTML = `
    <div class="share-section">
      <div class="share-section-title">View link — anyone with the link can view</div>
      <button class="btn btn-primary share-gen-btn" id="share-gen-viewer">Create view link</button>
      <div id="share-viewer-links">
        ${viewerInvites.length ? viewerInvites.map((inv) => `
          <div class="share-link-row" data-token="${esc(inv.id)}">
            <span class="share-link-role">👁 View</span>
            <input class="input share-link-input" readonly value="${esc(inviteUrl(inv.id))}">
            <button class="btn btn-ghost pk-sm share-copy" data-token="${esc(inv.id)}">Copy</button>
            <button class="btn btn-ghost pk-sm share-revoke" data-token="${esc(inv.id)}" title="Revoke">✕</button>
          </div>
        `).join('') : '<p class="share-hint">No view link yet.</p>'}
      </div>
    </div>

    <div class="share-section">
      <div class="share-section-title">Edit access — invite by email</div>
      <p class="share-hint">Enter the email address the person uses to sign in.</p>
      <div class="share-email-row">
        <input class="input share-email-input" id="share-email-input" type="email" placeholder="email@example.com">
        <button class="btn btn-primary" id="share-email-add">Invite</button>
      </div>
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

    <div class="share-section">
      <div class="share-section-title">Edit link — requires login (for reference)</div>
      <button class="btn btn-ghost share-gen-btn" id="share-gen-editor">Create edit link</button>
      <div id="share-editor-links">
        ${editorInvites.length ? editorInvites.map((inv) => `
          <div class="share-link-row" data-token="${esc(inv.id)}">
            <span class="share-link-role">✎ Edit</span>
            <input class="input share-link-input" readonly value="${esc(inviteUrl(inv.id))}">
            <button class="btn btn-ghost pk-sm share-copy" data-token="${esc(inv.id)}">Copy</button>
            <button class="btn btn-ghost pk-sm share-revoke" data-token="${esc(inv.id)}" title="Revoke">✕</button>
          </div>
        `).join('') : '<p class="share-hint">No edit link yet.</p>'}
      </div>
    </div>

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
  `;

  // Generate viewer invite link
  body.querySelector('#share-gen-viewer')?.addEventListener('click', async () => {
    try {
      await createInvite(tripId, 'viewer');
      await renderShareBody(body, tripId);
    } catch (e) { alert('Could not create view link. ' + String(e)); }
  });

  // Generate editor invite link
  body.querySelector('#share-gen-editor')?.addEventListener('click', async () => {
    try {
      await createInvite(tripId, 'editor');
      await renderShareBody(body, tripId);
    } catch (e) { alert('Could not create edit link. ' + String(e)); }
  });

  // Add email invite
  body.querySelector('#share-email-add')?.addEventListener('click', async () => {
    const input = body.querySelector<HTMLInputElement>('#share-email-input');
    const email = input?.value.trim() ?? '';
    if (!email) return;
    try {
      await addEmailInvite(tripId, email);
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

const PENDING_JOIN_KEY = 'otr_pending_join';

/** Extract a join token from the current hash (does not clear it). */
export function joinTokenFromHash(): string | null {
  const match = window.location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/** Stash token so it survives a sign-in redirect / page reload. */
export function savePendingJoin(token: string): void {
  sessionStorage.setItem(PENDING_JOIN_KEY, token);
}

/** Retrieve and clear the stashed token. */
function consumeStoredJoin(): string | null {
  const t = sessionStorage.getItem(PENDING_JOIN_KEY);
  if (t) sessionStorage.removeItem(PENDING_JOIN_KEY);
  return t;
}

async function executeJoin(token: string): Promise<void> {
  const invite = await getInvite(token);
  if (!invite || invite.revoked) {
    alert('This invite link is no longer valid.');
    return;
  }

  const ok = confirm(`Join "${invite.tripName}" as ${invite.role}?`);
  if (!ok) return;

  try {
    const tripId = await acceptInvite(token);
    if (tripId) {
      await switchTrip(tripId);
      location.reload();
    }
  } catch (e) {
    alert('Could not join the trip. ' + String(e));
  }
}

/**
 * If the URL is #/join/{token}, show a confirm dialog and accept the invite.
 * Call on boot after auth is ready. Returns true if it handled a join.
 * When the user isn't signed in, saves the token to sessionStorage so it
 * survives the sign-in flow and can be consumed by consumePendingJoin().
 */
export async function openJoinFromHash(): Promise<boolean> {
  const token = joinTokenFromHash();
  if (!token) return false;

  // Clear the join hash so a refresh doesn't re-trigger.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  if (!currentUser()) {
    // Stash token — will be picked up after sign-in by consumePendingJoin().
    savePendingJoin(token);
    return true;
  }

  await executeJoin(token);
  return true;
}

/**
 * After a successful sign-in, check if there is a stashed join token and
 * process it. Call once the authenticated shell has fully booted.
 * Returns true if it handled a pending join.
 */
export async function consumePendingJoin(): Promise<boolean> {
  const token = consumeStoredJoin();
  if (!token || !currentUser()) return false;
  await executeJoin(token);
  return true;
}
