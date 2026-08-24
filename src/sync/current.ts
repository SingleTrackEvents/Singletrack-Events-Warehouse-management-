import type { Session } from './types';

/**
 * The live session, readable outside React.
 *
 * The permission rules have to reach code that no component renders — the
 * repository helpers every screen writes through. Threading a session down to
 * `update()` from each of a dozen call sites would mean one of them is
 * eventually forgotten, and a forgotten one is a volunteer overwriting the
 * warehouse's numbers. One mirror, set by the session provider, keeps the
 * check in a single place.
 *
 * It is a convenience for the UI, never a security boundary: the server holds
 * the real copy of these rules.
 */
let live: Session | null = null;

export function setCurrentSession(session: Session | null): void {
  live = session;
}

export function currentSession(): Session | null {
  return live;
}
