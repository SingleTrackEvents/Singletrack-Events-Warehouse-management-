import type { TableName } from '../db/db';
import type { SyncMeta } from '../db/types';

/**
 * The contract between the app and whatever stores its data centrally.
 *
 * Nothing above this file knows whether the backend is Supabase, a self-hosted
 * Postgres, or the in-memory mock used in development and tests. That matters
 * for more than tidiness: the sync engine and the permission rules can be built
 * and proven against the mock now, and a real backend becomes an adapter rather
 * than a rewrite.
 */

/* ------------------------------------------------------------------ roles -- */

/**
 * Who someone is on a given event.
 *
 * Ordered from most to least authority. `roleAtLeast` relies on this order, so
 * new roles must be inserted in the right place rather than appended.
 */
export type Role = 'admin' | 'crew' | 'driver' | 'volunteer';

export const ROLES: Role[] = ['admin', 'crew', 'driver', 'volunteer'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  crew: 'Crew',
  driver: 'Driver',
  volunteer: 'Volunteer',
};

export const ROLE_BLURBS: Record<Role, string> = {
  admin: 'Full control, including the item catalogue and who else has access.',
  crew: 'Pack, adjust stock, run stocktakes and build transport loads.',
  driver: 'See assigned loads and confirm deliveries on the road.',
  volunteer: 'See one aid station’s packlist and record what actually arrived.',
};

/**
 * What a session is allowed to reach.
 *
 * A volunteer is pinned to one destination for one event; crew and admins are
 * unscoped. The backend is expected to enforce this too — the client-side check
 * is for a sensible UI, not for security.
 */
export interface Scope {
  /** Restrict to a single event. Null means every event. */
  eventId: string | null;
  /** Restrict further to one destination's packlists. Null means all of them. */
  destinationId: string | null;
}

export const UNSCOPED: Scope = { eventId: null, destinationId: null };

/* --------------------------------------------------------------- sessions -- */

export interface Session {
  /** Stable user id from the backend. */
  userId: string;
  /** What to show as the author of changes: a name, not an email. */
  displayName: string;
  /** Present for crew who signed in by email; absent for invited volunteers. */
  email: string | null;
  role: Role;
  scope: Scope;
  /** Opaque credential the backend recognises. Never inspected here. */
  token: string;
  /** ISO expiry. Invited volunteer sessions are deliberately short-lived. */
  expiresAt: string | null;
  /** True when the account was created by scanning an invite. */
  guest: boolean;
}

/** Returned when a magic link has been sent but not yet followed. */
export interface SignInChallenge {
  sent: boolean;
  /** Where the link went, echoed back so the UI can say "check jess@…". */
  email: string;
  /**
   * Development only: the mock backend hands the link straight back so the flow
   * can be exercised without an inbox. A real backend leaves this undefined.
   */
  devLink?: string;
}

/* ---------------------------------------------------------------- invites -- */

export interface Invite {
  id: string;
  /** The short token embedded in the QR, e.g. "AS3-J7QM-4KTP". */
  token: string;
  role: Role;
  scope: Scope;
  /** Human label so the crew can tell invites apart: "Aid 3 — Buffalo Plateau". */
  label: string;
  createdAt: string;
  /** ISO expiry; invites should not outlive the race weekend. */
  expiresAt: string | null;
  revokedAt: string | null;
  /** How many people have joined with it. */
  usedCount: number;
}

export interface CreateInviteInput {
  role: Role;
  scope: Scope;
  label: string;
  /** Days until the invite stops working. Defaults to a long weekend. */
  expiresInDays?: number;
}

/* ------------------------------------------------------------ change sets -- */

/** One table's worth of rows moving in either direction. */
export type ChangeSet = Partial<Record<TableName, SyncMeta[]>>;

export interface PushResult {
  /** Rows the backend accepted and stored. */
  accepted: number;
  /** Rows rejected because a newer revision already existed there. */
  stale: number;
  /** Rows rejected because the session's role may not write them. */
  refused: number;
  /**
   * Rows the backend already held that are newer than what was pushed, handed
   * back so the client can apply them without waiting for the next pull.
   */
  conflicts: ChangeSet;
  /** Cursor to pass to the next pull. */
  cursor: string;
}

export interface PullResult {
  changes: ChangeSet;
  /** Cursor for the following pull. */
  cursor: string;
  /** True when more rows are waiting and pull should be called again. */
  more: boolean;
}

/* --------------------------------------------------------------- passkeys -- */

/** A passkey registered against an account, as shown in the access screen. */
export interface Passkey {
  id: string;
  /** What the person called it: "Jess's iPhone". */
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/* ---------------------------------------------------------------- backend -- */

export interface SyncBackend {
  /** Shown in settings so it is obvious what the device is talking to. */
  readonly name: string;
  /** False for the mock, so the UI can be honest about what it is. */
  readonly isReal: boolean;

  /** The stored session, if the device is already signed in. */
  currentSession(): Promise<Session | null>;

  /**
   * Whether this backend can do passkeys. Checked before offering them, since
   * it depends on both the backend and the device having support.
   */
  readonly supportsPasskeys: boolean;

  /** Start an email sign-in. The user completes it by following the link. */
  signInWithEmail(email: string): Promise<SignInChallenge>;

  /** Finish an email sign-in from the token in the link. */
  completeEmailSignIn(token: string): Promise<Session>;

  /** Join from an invite QR, supplying only a display name. */
  joinWithInvite(token: string, displayName: string): Promise<Session>;

  signOut(): Promise<void>;

  /**
   * Sign in with a passkey — face, fingerprint or device PIN. No email, so
   * nothing to deliver and nothing to wait for.
   */
  signInWithPasskey?(): Promise<Session>;

  /** Add a passkey to the device currently signed in. */
  registerPasskey?(name: string): Promise<Passkey>;

  listPasskeys?(): Promise<Passkey[]>;
  deletePasskey?(passkeyId: string): Promise<void>;

  /** Send local changes. Must be safe to call repeatedly with the same rows. */
  push(session: Session, changes: ChangeSet): Promise<PushResult>;

  /** Fetch everything visible to this session changed since `cursor`. */
  pull(session: Session, cursor: string | null): Promise<PullResult>;

  createInvite(session: Session, input: CreateInviteInput): Promise<Invite>;
  listInvites(session: Session): Promise<Invite[]>;
  revokeInvite(session: Session, inviteId: string): Promise<void>;
}

export type SyncErrorKind = 'auth' | 'permission' | 'network' | 'conflict' | 'invalid';

/** Raised when the backend refuses an action, so the UI can explain rather than crash. */
export class SyncError extends Error {
  // Declared as a field rather than a constructor parameter property, which the
  // project's erasableSyntaxOnly setting disallows.
  kind: SyncErrorKind;

  constructor(message: string, kind: SyncErrorKind) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
  }
}
