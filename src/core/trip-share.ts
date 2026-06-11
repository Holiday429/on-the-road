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
} from '../data/trip-invites.ts';
import type { TripRole } from '../data/schema.ts';

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
  const [members, invites] = await Promise.all([tripMembers(tripId), listInvites(tripId)]);
  const me = currentUser()?.uid;

  body.innerHTML = `
    <div class="share-section">
      <div class="share-section-title">Invite link</div>
      <div class="share-role-row">
        <label class="share-role-opt"><input type="radio" name="share-role" value="editor" checked> Can edit</label>
        <label class="share-role-opt"><input type="radio" name="share-role" value="viewer"> View only</label>
      </div>
      <button class="btn btn-primary share-gen-btn" id="share-gen">Create invite link</button>
      <div id="share-links">
        ${invites.length ? invites.map((inv) => `
          <div class="share-link-row" data-token="${esc(inv.id)}">
            <span class="share-link-role">${inv.role === 'viewer' ? '👁 View' : '✎ Edit'}</span>
            <input class="input share-link-input" readonly value="${esc(inviteUrl(inv.id))}">
            <button class="btn btn-ghost pk-sm share-copy" data-token="${esc(inv.id)}">Copy</button>
            <button class="btn btn-ghost pk-sm share-revoke" data-token="${esc(inv.id)}" title="Revoke">✕</button>
          </div>
        `).join('') : '<p class="share-hint">No active links. Create one above.</p>'}
      </div>
    </div>

    <div class="share-section">
      <div class="share-section-title">Members (${members.length})</div>
      <div class="share-members">
        ${members.map((mem) => `
          <div class="share-member-row">
            <span class="share-member-uid">${esc(mem.uid === me ? 'You' : shortUid(mem.uid))}</span>
            <span class="share-member-role share-role-${mem.role}">${mem.role}</span>
            ${mem.role !== 'owner' && me && members.find((x) => x.uid === me)?.role === 'owner'
              ? `<button class="btn btn-ghost pk-sm share-remove-member" data-uid="${esc(mem.uid)}" title="Remove">Remove</button>`
              : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Generate invite
  body.querySelector('#share-gen')?.addEventListener('click', async () => {
    const role = (body.querySelector<HTMLInputElement>('input[name="share-role"]:checked')?.value
      ?? 'editor') as Exclude<TripRole, 'owner'>;
    try {
      await createInvite(tripId, role);
      await renderShareBody(body, tripId);
    } catch (e) {
      alert('Could not create invite. ' + String(e));
    }
  });

  // Copy
  body.querySelectorAll<HTMLElement>('.share-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = inviteUrl(btn.dataset.token!);
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
      catch { /* clipboard blocked — input is selectable as fallback */ }
    });
  });

  // Revoke
  body.querySelectorAll<HTMLElement>('.share-revoke').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this invite link? Anyone holding it can no longer join.')) return;
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

/**
 * If the URL is #/join/{token}, show a confirm dialog and accept the invite.
 * Call on boot after auth is ready. Returns true if it handled a join.
 */
export async function openJoinFromHash(): Promise<boolean> {
  const match = window.location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
  if (!match) return false;
  const token = match[1];

  // Clear the join hash so a refresh doesn't re-trigger.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  if (!currentUser()) {
    alert('Please sign in first, then open the invite link again to join.');
    return true;
  }

  const invite = await getInvite(token);
  if (!invite || invite.revoked) {
    alert('This invite link is no longer valid.');
    return true;
  }

  const ok = confirm(`Join "${invite.tripName}" as ${invite.role}?`);
  if (!ok) return true;

  try {
    const tripId = await acceptInvite(token);
    if (tripId) {
      await switchTrip(tripId);
      location.reload(); // simplest way to re-mount everything under the new trip
    }
  } catch (e) {
    alert('Could not join the trip. ' + String(e));
  }
  return true;
}
