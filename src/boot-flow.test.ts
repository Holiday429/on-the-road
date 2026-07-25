import { describe, expect, it } from 'vitest';
import {
  decideBootPath, shouldSkipAuthenticatedBoot, decideOnAuthTransition, isAnonymousUpgrade,
} from './boot-flow.ts';

describe('decideBootPath', () => {
  it('a resolved viewer invite always boots the viewer shell, even with a known user', () => {
    expect(decideBootPath({ viewerMode: true, user: { uid: 'u1' } })).toEqual({ kind: 'viewer' });
    expect(decideBootPath({ viewerMode: true, user: null })).toEqual({ kind: 'viewer' });
  });

  it('a known user (including an anonymous guest) boots the authenticated shell', () => {
    expect(decideBootPath({ viewerMode: false, user: { uid: 'u1' } })).toEqual({ kind: 'authenticated', uid: 'u1' });
  });

  it('no user and no viewer mode falls back to the guest shell', () => {
    expect(decideBootPath({ viewerMode: false, user: null })).toEqual({ kind: 'guest' });
  });
});

describe('shouldSkipAuthenticatedBoot', () => {
  it('skips when the shell is already mounted for this exact uid (re-entrant onAuth)', () => {
    expect(shouldSkipAuthenticatedBoot({ preparedUserId: 'u1', incomingUserId: 'u1' })).toBe(true);
  });

  it('does not skip on first boot (no prior uid)', () => {
    expect(shouldSkipAuthenticatedBoot({ preparedUserId: null, incomingUserId: 'u1' })).toBe(false);
  });

  it('does not skip when the uid actually changed (account switch)', () => {
    expect(shouldSkipAuthenticatedBoot({ preparedUserId: 'u1', incomingUserId: 'u2' })).toBe(false);
  });
});

describe('decideOnAuthTransition', () => {
  const base = { appEntered: false, viewerMode: false, invitePending: false, user: null };

  it('an already-open app always updates the shell in place, regardless of other flags', () => {
    expect(decideOnAuthTransition({ ...base, appEntered: true, user: { uid: 'u1', isAnonymous: false } }))
      .toEqual({ kind: 'update-shell', user: { uid: 'u1', isAnonymous: false } });
    expect(decideOnAuthTransition({ ...base, appEntered: true, user: null }))
      .toEqual({ kind: 'update-shell', user: null });
  });

  it('viewer mode auto-enters before the app has opened', () => {
    expect(decideOnAuthTransition({ ...base, viewerMode: true })).toEqual({ kind: 'viewer-auto-enter' });
  });

  it('an invite still resolving takes priority over showing the landing screen', () => {
    expect(decideOnAuthTransition({ ...base, invitePending: true })).toEqual({ kind: 'wait-for-invite' });
  });

  it('no user and nothing pending shows the landing screen', () => {
    expect(decideOnAuthTransition({ ...base, user: null })).toEqual({ kind: 'show-landing' });
  });

  it('a user is already known pre-entry — wait for the Enter click', () => {
    expect(decideOnAuthTransition({ ...base, user: { uid: 'u1', isAnonymous: false } })).toEqual({ kind: 'noop' });
  });

  it('viewer mode wins over a pending invite (both can theoretically be true mid-transition)', () => {
    expect(decideOnAuthTransition({ ...base, viewerMode: true, invitePending: true })).toEqual({ kind: 'viewer-auto-enter' });
  });
});

describe('isAnonymousUpgrade', () => {
  it('detects an anonymous guest linking to Google in place (same uid, isAnonymous flips false)', () => {
    expect(isAnonymousUpgrade({
      lastRenderedAnonymous: true,
      preparedUserId: 'u1',
      user: { uid: 'u1', isAnonymous: false },
    })).toBe(true);
  });

  it('is false when the last render was already non-anonymous', () => {
    expect(isAnonymousUpgrade({
      lastRenderedAnonymous: false,
      preparedUserId: 'u1',
      user: { uid: 'u1', isAnonymous: false },
    })).toBe(false);
  });

  it('is false when the uid changed (a different account, not an in-place upgrade)', () => {
    expect(isAnonymousUpgrade({
      lastRenderedAnonymous: true,
      preparedUserId: 'u1',
      user: { uid: 'u2', isAnonymous: false },
    })).toBe(false);
  });

  it('is false when the user is still anonymous (no upgrade happened)', () => {
    expect(isAnonymousUpgrade({
      lastRenderedAnonymous: true,
      preparedUserId: 'u1',
      user: { uid: 'u1', isAnonymous: true },
    })).toBe(false);
  });
});
