import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SYNCED_TABLES, db } from '../db/db';
import { getAuthNotice, setAuthNotice } from './authRedirect';
import { cleanDisplayName, displayNameFromEmail } from './names';
import type { TableName } from '../db/db';
import type { SyncMeta } from '../db/types';
import type {
  ChangeSet,
  CreateInviteInput,
  Invite,
  Passkey,
  PullResult,
  PushResult,
  Role,
  Scope,
  Session,
  SignInChallenge,
  SyncBackend,
} from './types';
import { SyncError } from './types';

/**
 * Supabase adapter.
 *
 * The server is a sync log, not a query surface: one `records` table keyed by
 * (table_name, id), with event and destination lifted out as columns so
 * row-level security can scope on them without parsing json. The app queries
 * its local database, never this one, so there is nothing to gain from
 * mirroring the relational shape — and a great deal of schema and migration
 * risk to lose.
 *
 * Conflict resolution lives in the `push_records` function rather than here,
 * because two phones can push at once and only the database can settle that
 * safely. See supabase/schema.sql.
 */

/** Rows are denormalised on the way out so policies can filter on them. */
interface WireRow {
  table_name: TableName;
  id: string;
  data: SyncMeta;
  rev: number;
  updated_at: string;
  deleted_at: string | null;
  device_id: string;
  event_id: string | null;
  destination_id: string | null;
}

interface PushResponse {
  accepted: number;
  stale: number;
  refused: number;
  conflicts: Array<{ table_name: TableName; data: SyncMeta }>;
}

interface MembershipRow {
  user_id: string;
  role: Role;
  event_id: string | null;
  destination_id: string | null;
  display_name: string;
  expires_at: string | null;
}

/** How many rows to send per request. */
const PAGE = 500;

/** Scope of a parent row, looked up so children can inherit it. */
export interface ParentScopes {
  /** packlist id → its event and destination. */
  packlists: Map<string, { eventId: string | null; destinationId: string | null }>;
  /** load id → its event. */
  loads: Map<string, string | null>;
}

export const NO_PARENTS: ParentScopes = { packlists: new Map(), loads: new Map() };

/**
 * Pull the scope out of a row.
 *
 * Events and destinations identify themselves by their own id. Most other rows
 * carry a foreign key — but packlist lines and containers reference only their
 * packlist, so their scope has to be inherited from it. Leaving those null is
 * not a cosmetic gap: the security policies filter on exactly these two columns,
 * and a null scope is what a volunteer would need to reach another aid station.
 */
export function scopeOf(
  table: TableName,
  row: SyncMeta,
  parents: ParentScopes = NO_PARENTS,
): Pick<WireRow, 'event_id' | 'destination_id'> {
  const record = row as SyncMeta & {
    eventId?: string;
    destinationId?: string;
    packlistId?: string;
    loadId?: string;
  };

  if (table === 'events') return { event_id: row.id, destination_id: null };
  if (table === 'destinations') {
    return { event_id: record.eventId ?? null, destination_id: row.id };
  }

  // Children of a packlist inherit its whole scope.
  if (table === 'packlistLines' || table === 'containers') {
    const parent = record.packlistId ? parents.packlists.get(record.packlistId) : undefined;
    return {
      event_id: parent?.eventId ?? null,
      destination_id: parent?.destinationId ?? null,
    };
  }

  // A stop names its destination but not its event; the load knows that.
  if (table === 'loadStops') {
    return {
      event_id: (record.loadId ? parents.loads.get(record.loadId) : null) ?? null,
      destination_id: record.destinationId ?? null,
    };
  }

  return {
    event_id: record.eventId ?? null,
    destination_id: record.destinationId ?? null,
  };
}

/** Flatten a change set into the wire shape the push function expects. */
export function toWire(changes: ChangeSet, parents: ParentScopes = NO_PARENTS): WireRow[] {
  const rows: WireRow[] = [];
  for (const table of SYNCED_TABLES) {
    for (const row of changes[table] ?? []) {
      rows.push({
        table_name: table,
        id: row.id,
        data: row,
        rev: row.rev,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt,
        device_id: row.deviceId,
        ...scopeOf(table, row, parents),
      });
    }
  }
  return rows;
}

/**
 * Read the parents a change set's children need, from the local database.
 * Cheap: only the packlists and loads actually referenced are fetched.
 */
export async function loadParentScopes(changes: ChangeSet): Promise<ParentScopes> {
  const packlistIds = new Set<string>();
  const loadIds = new Set<string>();

  for (const table of ['packlistLines', 'containers'] as const) {
    for (const row of changes[table] ?? []) {
      const id = (row as SyncMeta & { packlistId?: string }).packlistId;
      if (id) packlistIds.add(id);
    }
  }
  for (const row of changes.loadStops ?? []) {
    const id = (row as SyncMeta & { loadId?: string }).loadId;
    if (id) loadIds.add(id);
  }

  const parents: ParentScopes = { packlists: new Map(), loads: new Map() };
  if (packlistIds.size) {
    const rows = await db.packlists.bulkGet([...packlistIds]);
    rows.forEach((row) => {
      if (row) parents.packlists.set(row.id, { eventId: row.eventId, destinationId: row.destinationId });
    });
  }
  if (loadIds.size) {
    const rows = await db.loads.bulkGet([...loadIds]);
    rows.forEach((row) => {
      if (row) parents.loads.set(row.id, row.eventId);
    });
  }
  return parents;
}

/** Rebuild a change set from rows coming back down. */
export function fromWire(rows: Array<{ table_name: TableName; data: SyncMeta }>): ChangeSet {
  const changes: ChangeSet = {};
  for (const row of rows) {
    (changes[row.table_name] ??= []).push(row.data);
  }
  return changes;
}

function sessionFrom(user: User, membership: MembershipRow, token: string): Session {
  return {
    userId: user.id,
    displayName:
      membership.display_name || displayNameFromEmail(user.email ?? '') || 'Crew',
    email: user.email ?? null,
    role: membership.role,
    scope: { eventId: membership.event_id, destinationId: membership.destination_id },
    token,
    expiresAt: membership.expires_at,
    guest: user.is_anonymous ?? !user.email,
  };
}

/**
 * Turn a server error into something worth showing a person.
 *
 * The rate-limit case matters most: Supabase's built-in email service allows
 * only a couple of messages an hour across the whole project, and its raw
 * message does not say that — so someone retrying a failed sign-in burns
 * through the allowance in under a minute and has no idea why.
 */
export function toSyncError(message: string): SyncError {
  const text = message.replace(/^.*?:\s*/, '');

  if (/rate limit/i.test(text) || /too many requests/i.test(text)) {
    return new SyncError(
      'Too many sign-in emails have been requested. The built-in email service only allows a couple an hour, ' +
        'and the limit covers the whole project — trying a different address will not help. ' +
        'Wait about an hour and request one link, or set up a proper email sender in Supabase to remove the limit.',
      'auth',
    );
  }
  // Order matters: the no-access message ends "...ask an admin for an invite",
  // so it has to be matched before the invite rule or it lands in the wrong bucket.
  if (/no access/i.test(text)) return new SyncError(text, 'permission');
  if (/invite/i.test(text)) return new SyncError(text, 'auth');
  if (/not signed in/i.test(text)) return new SyncError(text, 'auth');
  return new SyncError(text || 'Something went wrong talking to the server.', 'network');
}

/**
 * Does this browser have WebAuthn at all?
 *
 * Old devices and some in-app browsers do not, and offering a passkey button
 * that can only fail is worse than not offering one.
 */
export function deviceSupportsPasskeys(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials)
  );
}

/**
 * WebAuthn failures are mostly the person cancelling or the domain being
 * misconfigured, and the raw messages say neither.
 */
function toPasskeyError(message: string): SyncError {
  if (/NotAllowed|abort|cancel/i.test(message)) {
    return new SyncError('Passkey cancelled — nothing has changed.', 'auth');
  }
  if (/rp|relying party|origin|domain/i.test(message)) {
    return new SyncError(
      'This site is not on the passkey allow-list. An admin needs to add it under ' +
        'Authentication → Passkeys in Supabase, using the bare domain as the Relying Party ID.',
      'permission',
    );
  }
  if (/no credentials|not found|no passkey/i.test(message)) {
    return new SyncError(
      'This phone has no passkey for the app yet. Passkeys are added from inside the app once you ' +
        'are signed in — sign in with email, then Accounts & sync → Passkeys → Add this device.',
      'auth',
    );
  }
  return new SyncError(message || 'The passkey could not be used.', 'auth');
}

export class SupabaseBackend implements SyncBackend {
  readonly name = 'Supabase';
  readonly isReal = true;
  readonly supportsPasskeys = deviceSupportsPasskeys();

  private client: SupabaseClient;

  constructor(url: string, publishableKey: string) {
    this.client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Passkeys are behind an opt-in flag while the API is in beta; without
        // it every passkey method throws.
        experimental: { passkey: true },
      },
    });
  }

  /**
   * Sign in with a passkey.
   *
   * The whole WebAuthn ceremony is handled by the client library: it asks the
   * server for a challenge, calls navigator.credentials.get(), and posts the
   * signed result back. Nothing is delivered by email, so none of the failure
   * modes that plagued magic links apply.
   */
  async signInWithPasskey(): Promise<Session> {
    const { data, error } = await this.client.auth.signInWithPasskey();
    if (error) throw toPasskeyError(error.message);
    if (!data?.session || !data.user) {
      throw new SyncError('That passkey did not produce a session.', 'auth');
    }

    const { data: membership, error: membershipError } = await this.client.rpc('ensure_membership', {
      p_display_name: data.user.email?.split('@')[0] ?? '',
    });
    if (membershipError) throw toSyncError(membershipError.message);
    return sessionFrom(data.user, membership as MembershipRow, data.session.access_token);
  }

  /**
   * Add a passkey to whoever is signed in on this device.
   *
   * Registration needs an existing session, so the very first sign-in on an
   * account still has to happen by email. After that the email is never needed
   * again on that device.
   */
  async registerPasskey(name: string): Promise<Passkey> {
    const { data, error } = await this.client.auth.registerPasskey();
    if (error) throw toPasskeyError(error.message);
    if (!data) throw new SyncError('The passkey was not saved.', 'auth');

    // The name is set separately: registration itself takes no label.
    const friendlyName = name.trim().slice(0, 120);
    if (friendlyName) {
      await this.client.auth.passkey.update({ passkeyId: data.id, friendlyName });
    }
    return {
      id: data.id,
      name: friendlyName || data.friendly_name || 'This device',
      createdAt: data.created_at,
      lastUsedAt: null,
    };
  }

  async listPasskeys(): Promise<Passkey[]> {
    const { data, error } = await this.client.auth.passkey.list();
    if (error || !data) return [];
    return data.map((entry) => ({
      id: entry.id,
      name: entry.friendly_name || 'Unnamed device',
      createdAt: entry.created_at,
      lastUsedAt: entry.last_used_at ?? null,
    }));
  }

  async deletePasskey(passkeyId: string): Promise<void> {
    const { error } = await this.client.auth.passkey.delete({ passkeyId });
    if (error) throw toPasskeyError(error.message);
  }

  async currentSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) return null;

    let membership = await this.membership();
    if (!membership) {
      // Arriving back from an email link: Supabase has authenticated the
      // person, but nothing has claimed a membership for them yet. Without
      // this the app finds an account it cannot describe and shows the sign-in
      // screen to someone who is already signed in.
      membership = await this.claimMembership(data.session.user.email ?? '');
      if (!membership) return null;
    }
    return sessionFrom(data.session.user, membership, data.session.access_token);
  }

  /**
   * Claim a membership for the signed-in user. The first person to arrive
   * becomes the admin; for anyone else this raises, and the reason is kept so
   * the sign-in screen can explain rather than silently showing a login form.
   */
  private async claimMembership(email: string): Promise<MembershipRow | null> {
    const { data, error } = await this.client.rpc('ensure_membership', {
      p_display_name: displayNameFromEmail(email),
    });
    if (error) {
      setAuthNotice(toSyncError(error.message).message);
      return null;
    }
    return data as MembershipRow;
  }

  /**
   * Finish a sign-in with the six-digit code from the email.
   *
   * This is the path that works everywhere. Following the link opens whatever
   * the phone considers the default browser, which for an installed app is a
   * different place with its own separate storage — so the tab that opens is
   * signed in and the app on the home screen is not. Typing the code into the
   * copy of the app you are actually using avoids the problem entirely.
   */
  async verifyEmailCode(email: string, code: string): Promise<Session> {
    const { data, error } = await this.client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.replace(/\s+/g, ''),
      type: 'email',
    });
    if (error) throw toSyncError(error.message);
    if (!data.session || !data.user) {
      throw new SyncError('That code did not work. Check it and try again.', 'auth');
    }

    const membership = await this.claimMembership(data.user.email ?? '');
    if (!membership) {
      throw new SyncError(
        getAuthNotice() || 'No access yet — ask an admin for an invite.',
        'permission',
      );
    }
    return sessionFrom(data.user, membership, data.session.access_token);
  }

  /** The caller's own membership row, or null if they have not been granted one. */
  private async membership(): Promise<MembershipRow | null> {
    const { data, error } = await this.client.from('memberships').select('*').maybeSingle();
    if (error) return null;
    return (data as MembershipRow) ?? null;
  }

  async signInWithEmail(email: string): Promise<SignInChallenge> {
    const address = email.trim().toLowerCase();
    const { error } = await this.client.auth.signInWithOtp({
      email: address,
      options: {
        // Back to wherever the app is served from, hash routing and all.
        emailRedirectTo: typeof location !== 'undefined'
          ? `${location.origin}${location.pathname}`
          : undefined,
      },
    });
    if (error) throw toSyncError(error.message);
    return { sent: true, email: address };
  }

  /**
   * Finish sign-in. Supabase handles the link itself via `detectSessionInUrl`,
   * so by the time this runs the session usually exists already; the work here
   * is claiming a membership.
   */
  async completeEmailSignIn(): Promise<Session> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) throw new SyncError('That sign-in link has expired. Ask for a new one.', 'auth');

    // The first person to sign in becomes the admin; everyone else needs an
    // invite, and this raises for them.
    const { data: membership, error } = await this.client.rpc('ensure_membership', {
      p_display_name: displayNameFromEmail(data.session.user.email ?? ''),
    });
    if (error) throw toSyncError(error.message);
    return sessionFrom(data.session.user, membership as MembershipRow, data.session.access_token);
  }

  /** Rename this account. */
  async setDisplayName(name: string): Promise<Session> {
    const { data: sessionData } = await this.client.auth.getSession();
    if (!sessionData.session) throw new SyncError('Not signed in.', 'auth');

    const { data, error } = await this.client.rpc('update_display_name', {
      p_display_name: cleanDisplayName(name),
    });
    if (error) throw toSyncError(error.message);
    return sessionFrom(
      sessionData.session.user,
      data as MembershipRow,
      sessionData.session.access_token,
    );
  }

  /**
   * Volunteers get an anonymous account behind the scenes, then redeem the
   * invite for a scoped membership. They never see any of that — they type a
   * name and they are in.
   */
  async joinWithInvite(token: string, displayName: string): Promise<Session> {
    let { data } = await this.client.auth.getSession();
    if (!data.session) {
      const { error } = await this.client.auth.signInAnonymously();
      if (error) {
        throw new SyncError(
          'Guest access is switched off for this project. An admin needs to enable anonymous sign-ins in Supabase.',
          'auth',
        );
      }
      ({ data } = await this.client.auth.getSession());
    }
    if (!data.session) throw new SyncError('Could not start a guest session.', 'auth');

    const { data: membership, error } = await this.client.rpc('redeem_invite', {
      p_token: token,
      p_display_name: displayName,
    });
    if (error) throw toSyncError(error.message);
    return sessionFrom(data.session.user, membership as MembershipRow, data.session.access_token);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async push(_session: Session, changes: ChangeSet): Promise<PushResult> {
    // Children inherit their packlist's or load's scope; without this the
    // security policies would see a null scope and reject the write.
    const rows = toWire(changes, await loadParentScopes(changes));
    if (!rows.length) return { accepted: 0, stale: 0, refused: 0, conflicts: {} };

    const { data, error } = await this.client.rpc('push_records', { p_rows: rows });
    if (error) throw toSyncError(error.message);

    const response = data as PushResponse;
    return {
      accepted: response.accepted,
      stale: response.stale,
      refused: response.refused,
      conflicts: fromWire(response.conflicts ?? []),
    };
  }

  async pull(_session: Session, cursor: string | null): Promise<PullResult> {
    const since = cursor ? Number(cursor) : 0;
    // RLS decides what comes back, so there is no scope filter here on purpose:
    // duplicating it client-side would only drift from the policy over time.
    const { data, error } = await this.client
      .from('records')
      .select('table_name, data, seq')
      .gt('seq', since)
      .order('seq', { ascending: true })
      .limit(PAGE);
    if (error) throw toSyncError(error.message);

    const rows = (data ?? []) as Array<{ table_name: TableName; data: SyncMeta; seq: number }>;
    const highest = rows.reduce((max, row) => Math.max(max, row.seq), since);
    return {
      changes: fromWire(rows),
      cursor: String(highest),
      more: rows.length === PAGE,
    };
  }

  async createInvite(_session: Session, input: CreateInviteInput): Promise<Invite> {
    const days = input.expiresInDays ?? 4;
    const { data, error } = await this.client
      .from('invites')
      .insert({
        token: inviteToken(),
        role: input.role,
        event_id: input.scope.eventId,
        destination_id: input.scope.destinationId,
        label: input.label,
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      })
      .select()
      .single();
    if (error) throw toSyncError(error.message);
    return toInvite(data as InviteRow);
  }

  async listInvites(): Promise<Invite[]> {
    const { data, error } = await this.client
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false });
    // A non-admin simply sees none, rather than an error they can do nothing about.
    if (error) return [];
    return (data as InviteRow[]).map(toInvite);
  }

  async revokeInvite(_session: Session, inviteId: string): Promise<void> {
    const { error } = await this.client
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId);
    if (error) throw toSyncError(error.message);
  }
}

interface InviteRow {
  id: string;
  token: string;
  role: Role;
  event_id: string | null;
  destination_id: string | null;
  label: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  used_count: number;
}

function toInvite(row: InviteRow): Invite {
  const scope: Scope = { eventId: row.event_id, destinationId: row.destination_id };
  return {
    id: row.id,
    token: row.token,
    role: row.role,
    scope,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    usedCount: row.used_count,
  };
}

/** Same unambiguous alphabet as the crate codes — these get read out over radios. */
function inviteToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRTUVWXY346789';
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}
