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
  { key: 'stocktakes', label: 'Run stocktakes', hint: 'Count the warehouse and correct the numbers.', warehouse: true },
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

/** What an invite or a person is given: the parts the access editor sets. */
export interface AccessGrant {
  role: Role;
  scope: Scope;
  /** Ticked boxes; null means the role's own rules. */
  access: Access[] | null;
}

/** Someone with access, as the People list shows them. */
export interface Member {
  userId: string;
  displayName: string;
  /** Null for people who joined by invite. */
  email: string | null;
  role: Role;
  scope: Scope;
  access: Access[] | null;
  expiresAt: string | null;
  /** The invite they still follow, if any. Changing them on their own unlinks it. */
  inviteId: string | null;
  createdAt: string;
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

/**
 * The invites still working, and the people, that open one station. Asked
 * before the station is removed: each of them would be left pointing at a
 * station that is gone.
 */
export function accessPointingAt(
  destinationId: string,
  invites: Invite[],
  members: Member[],
  now = Date.now(),
): { invites: number; members: number } {
  const live = (expiresAt: string | null) => !expiresAt || new Date(expiresAt).getTime() > now;
  return {
    invites: invites.filter(
      (invite) => invite.scope.destinationId === destinationId && !invite.revokedAt && live(invite.expiresAt),
    ).length,
    members: members.filter((member) => member.scope.destinationId === destinationId && live(member.expiresAt))
      .length,
  };
}

/** Calendar days ("2026-11-14") as the date input gives them. */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** How long an invite for no event in particular lasts unless told otherwise. */
export const INVITE_DEFAULT_DAYS = 30;

/**
 * The day a new invite should stop working, before anyone picks one.
 *
 * An invite for an event lasts to the end of its last day, so a QR printed a
 * fortnight out still works on race morning. With no event chosen, or one
 * already over, a month.
 */
export function defaultInviteExpiryDay(
  event: { startDate: string; endDate?: string | null } | undefined,
  today: string,
): string {
  const last = event ? event.endDate || event.startDate : '';
  if (last && last >= today) return last;
  return addDays(today, INVITE_DEFAULT_DAYS);
}

/**
 * The Sunday a race weekend ends on, for the quick date: this coming Sunday,
 * or next week's when today already is Sunday, since an invite ending tonight
 * is never what was meant.
 */
export function weekendSunday(today: string): string {
  const [year, month, date] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return addDays(today, (7 - weekday) % 7 || 7);
}

/**
 * An invite code the way it is stored, from however it was typed or read out.
 *
 * Over the radio "4Q8K-TP4L" arrives as "4q8k tp4l" or "4Q8KTP4L": the
 * spaces go, the letters go up, and eight characters get their dash back.
 * Anything else is passed on uppercased, so an odd old code still reaches the
 * server to be judged there.
 */
export function normaliseInviteCode(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  const bare = compact.replace(/-/g, '');
  return /^[A-Z0-9]{8}$/.test(bare) ? `${bare.slice(0, 4)}-${bare.slice(4)}` : compact;
}

/** Two codes are the same invite when their letters and digits match. */
export function sameInviteCode(a: string, b: string): boolean {
  const key = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key(a) === key(b);
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

  /**
   * Sign in with an email address and a password. Nothing is delivered, so it
   * works on a device with no inbox and on a project whose mailer is down.
   */
  signInWithPassword?(email: string, password: string): Promise<Session>;

  /**
   * Create an account with a password instead of waiting for a code.
   *
   * The account is only ever half the story: access still comes from an
   * invite, so for anyone but the first person this throws a `permission`
   * error once the account exists, and the sign-in screen sends them to type
   * their invite code. Their account stays on the device for that step.
   */
  createAccountWithPassword?(email: string, password: string): Promise<Session>;

  /** Set or change the password on the account signed in on this device. */
  setPassword?(password: string): Promise<void>;

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
  /**
   * Move when an invite stops working, later or sooner, or take its end date
   * away (null). Everyone who joined with it moves with it, including anyone
   * whose access had already run out, so extending a weekend does not mean
   * printing new QRs.
   */
  setInviteExpiry(session: Session, inviteId: string, expiresAt: string | null): Promise<Invite>;
  /**
   * Change what an invite gives, and everyone still following it. A blank
   * label keeps the one it has.
   */
  updateInvite(session: Session, inviteId: string, grant: AccessGrant & { label: string }): Promise<Invite>;

  /** Everyone with access. Admins only. */
  listMembers(session: Session): Promise<Member[]>;
  /**
   * Change one person. They stop following their invite, so a later change
   * to it does not undo this. Nobody may change themselves.
   */
  updateMember(
    session: Session,
    userId: string,
    grant: AccessGrant & { expiresAt: string | null },
  ): Promise<Member>;
  /** Take someone's access away. Nobody may remove themselves. */
  removeMember(session: Session, userId: string): Promise<void>;
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
