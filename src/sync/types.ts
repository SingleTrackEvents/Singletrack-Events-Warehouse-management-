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
  crew: 'Pack, build transport loads and plan food. Given every event, they also run the warehouse: stock, stocktakes and templates.',
  driver: 'See assigned loads and confirm deliveries on the road.',
  volunteer: 'See one aid station’s packlist and record what actually arrived.',
};

/**
 * What a session is allowed to reach.
 *
 * A volunteer is pinned to one destination for one event. Crew and drivers may
 * be pinned to one event, in which case they see that event and the catalogue
 * and nothing warehouse-wide; given no event they run the whole warehouse.
 * Admins are always unscoped. The backend is expected to enforce this too —
 * the client-side check is for a sensible UI, not for security.
 */
export interface Scope {
  /** Restrict to a single event. Null means every event. */
  eventId: string | null;
  /** Restrict further to one destination's packlists. Null means all of them. */
  destinationId: string | null;
}

export const UNSCOPED: Scope = { eventId: null, destinationId: null };

/* ----------------------------------------------------------------- access -- */

/**
 * The tick boxes on an invite.
 *
 * A role is a preset: volunteer, driver and crew each start with a sensible set
 * of these ticked. An admin can then tick more or fewer for one invite, say a
 * volunteer who should also see the food plan, and the invite carries the list.
 * Seeing the packlists the scope admits is never a box: an account that could
 * not see them would have nothing to open.
 *
 * Mirrored by access_* in supabase/schema.sql, which is the real boundary.
 */
export type Access =
  | 'receive'
  | 'pack'
  | 'deliver'
  | 'loads'
  | 'catalogue'
  | 'stock'
  | 'food'
  | 'events'
  | 'shopping'
  | 'stocktakes'
  | 'templates';

export interface AccessOption {
  key: Access;
  label: string;
  hint: string;
  /** Warehouse-wide: only takes effect on an invite given every event. */
  warehouse?: boolean;
}

/** In the order the invite sheet lists them: the station first, the warehouse last. */
export const ACCESS_OPTIONS: AccessOption[] = [
  { key: 'receive', label: 'Record what arrived', hint: 'Tick off deliveries and returns at the station.' },
  { key: 'pack', label: 'Pack and edit packlists', hint: 'Tick lines packed, add and change lines.' },
  { key: 'deliver', label: 'Transport: confirm deliveries', hint: 'See the loads and sign them off on the road.' },
  { key: 'loads', label: 'Transport: plan loads', hint: 'Build and change the truck and van loads.' },
  { key: 'catalogue', label: 'See the stock catalogue', hint: 'Items, categories and templates, read only.' },
  { key: 'food', label: 'Food plan', hint: 'Race projections and aid station food quantities.' },
  { key: 'events', label: 'Edit event and stations', hint: 'Names, dates, access notes and station details.' },
  { key: 'shopping', label: 'Shopping list', hint: 'Add to it, tick it off, book it into stock.' },
  { key: 'stock', label: 'Edit stock', hint: 'Add items and adjust quantities.', warehouse: true },
  { key: 'stocktakes', label: 'Run stocktakes', hint: 'Count the shed and correct the numbers.', warehouse: true },
  { key: 'templates', label: 'Edit templates', hint: 'The reusable lists packlists are built from.', warehouse: true },
];

export const ACCESS_KEYS: Access[] = ACCESS_OPTIONS.map((option) => option.key);

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
  /**
   * The ticked boxes from a customised invite. Null or absent means the role's
   * own rules, which is every account that was not customised.
   */
  access?: Access[] | null;
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
  /** Development only: the code the mock will accept. */
  devCode?: string;
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
  /** Ticked boxes when customised; null means the role's own rules. */
  access?: Access[] | null;
}

export interface CreateInviteInput {
  role: Role;
  scope: Scope;
  label: string;
  /** Days until the invite stops working. Defaults to a long weekend. */
  expiresInDays?: number;
  /**
   * An exact ISO expiry, chosen on a calendar, or null for none. Wins over
   * expiresInDays when given.
   */
  expiresAt?: string | null;
  /** Ticked boxes; leave out or null for the role's own rules. */
  access?: Access[] | null;
}

/**
 * When a new invite stops working: the date picked on the calendar, or never
 * when "no expiry" was chosen, or a long weekend from now.
 */
export function inviteExpiry(input: CreateInviteInput, now = Date.now()): string | null {
  if (input.expiresAt !== undefined) return input.expiresAt;
  const days = input.expiresInDays ?? 4;
  return new Date(now + days * 86_400_000).toISOString();
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
  // Deliberately no cursor here. The pull cursor may only ever advance as the
  // result of a pull: letting a push move it made a device mark itself as
  // having seen rows it had never received, so a second phone uploading its own
  // work would silently skip everything the first phone had already sent.
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

  /**
   * Finish an email sign-in with the code from the message instead of the link.
   * Works inside an installed app, where following a link lands in a different
   * browser with its own storage.
   */
  verifyEmailCode?(email: string, code: string): Promise<Session>;

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

  /**
   * Change the name shown on this account. A name guessed from an email is a
   * starting point, not an answer — plenty of work addresses are not names.
   */
  setDisplayName?(name: string): Promise<Session>;

  /**
   * A credential the project's other services will accept right now.
   *
   * The token on the session is the one issued at sign-in and goes stale
   * within the hour; the client library refreshes it quietly in the
   * background, so anything calling a server function has to ask for the
   * current one rather than reuse what the session carries.
   */
  accessToken?(): Promise<string | null>;

  /** Send local changes. Must be safe to call repeatedly with the same rows. */
  push(session: Session, changes: ChangeSet): Promise<PushResult>;

  /** Fetch everything visible to this session changed since `cursor`. */
  pull(session: Session, cursor: string | null): Promise<PullResult>;

  createInvite(session: Session, input: CreateInviteInput): Promise<Invite>;
  listInvites(session: Session): Promise<Invite[]>;
  revokeInvite(session: Session, inviteId: string): Promise<void>;
  /**
   * Remove an invite outright.
   *
   * Revoking stops an invite working but leaves it on the list, and a season's
   * worth of spent aid-station QRs buries the ones that still matter. Deleting
   * is for tidying those away; anyone who already joined keeps their session
   * until it expires, exactly as with a revoke.
   */
  deleteInvite(session: Session, inviteId: string): Promise<void>;
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
