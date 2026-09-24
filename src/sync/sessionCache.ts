import type { Session } from './types';

/**
 * The last session this device was given, kept for when the server cannot
 * be asked.
 *
 * Describing a session takes two things: the credential, which the auth client
 * keeps on the device itself, and the membership, which lives only on the
 * server. On a reload with no signal the credential was there and the
 * membership was not, so the app decided nobody was signed in. Before the
 * sign-in page became the only page for a signed-out device that was merely
 * odd; now it would lock a driver out of their run sheet in the one place the
 * app most needs to work. So the membership is remembered here, and used when,
 * and only when, the server cannot be reached.
 *
 * The credential is never stored here. It is matched by user id on the way
 * back out, so a remembered membership can only ever be paired with the
 * account that earned it.
 */

const KEY = 'stw.sync.session';

type Remembered = Omit<Session, 'token'>;

export function rememberSession(session: Session): void {
  if (typeof localStorage === 'undefined') return;
  const { token: _token, ...rest } = session;
  localStorage.setItem(KEY, JSON.stringify(rest satisfies Remembered));
}

/** The remembered session for this user with a live credential attached, if any. */
export function recallSession(userId: string, token: string): Session | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const remembered = JSON.parse(raw) as Remembered;
    if (remembered.userId !== userId) return null;
    return { ...remembered, token };
  } catch {
    return null;
  }
}

export function forgetSession(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
