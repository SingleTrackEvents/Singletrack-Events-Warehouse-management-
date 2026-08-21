import Dexie from 'dexie';
import type { Table } from 'dexie';
import { ALL_TABLES, newId, nowIso } from '../db/db';
import type { TableName } from '../db/db';
import type { SyncMeta } from '../db/types';
import { shouldReplace } from '../domain/backup';
import { cleanDisplayName, displayNameFromEmail } from './names';
import { inScope, writableTables } from './permissions';
import type {
  ChangeSet,
  CreateInviteInput,
  Invite,
  PullResult,
  PushResult,
  Role,
  Session,
  SignInChallenge,
  SyncBackend,
} from './types';
import { SyncError } from './types';

/**
 * A stand-in server.
 *
 * It stores rows in its own IndexedDB database, entirely separate from the
 * app's, and applies the same conflict rule and the same permission checks a
 * real backend will. That makes it more than a stub: the sync engine and the
 * role model can be exercised end to end — including a volunteer being refused
 * a write — before anyone signs up for a hosted database.
 *
 * It cannot do the one thing a real backend is for: move data between devices.
 * Anything relying on that has to wait for the Supabase adapter.
 */

interface StoredRow {
  /** `${table}:${id}`, so one store holds every table. */
  key: string;
  table: TableName;
  id: string;
  /** Server-side ordering, used as the pull cursor. */
  seq: number;
  row: SyncMeta;
}

interface StoredSession extends Session {
  key: string;
}

class MockServerDb extends Dexie {
  rows!: Table<StoredRow, string>;
  sessions!: Table<StoredSession, string>;
  invites!: Table<Invite, string>;
  meta!: Table<{ key: string; value: number }, string>;

  constructor() {
    super('singletrack-sync-mock');
    this.version(1).stores({
      rows: 'key, table, seq',
      sessions: 'key, userId',
      invites: 'id, token',
      meta: 'key',
    });
  }
}

const server = new MockServerDb();
const SESSION_KEY = 'stw.sync.mock.session';

/** Monotonic sequence, standing in for a database transaction id. */
async function nextSeq(count: number): Promise<number> {
  return server.transaction('rw', server.meta, async () => {
    const current = (await server.meta.get('seq'))?.value ?? 0;
    const next = current + count;
    await server.meta.put({ key: 'seq', value: next });
    return current;
  });
}

/** Sessions live in localStorage so a reload keeps you signed in. */
function loadSession(): Session | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null): void {
  if (typeof localStorage === 'undefined') return;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

/** Everyone who signs in by email on the mock is treated as an admin. */
function roleForEmail(): Role {
  return 'admin';
}

/** A stable six-digit code for an address, standing in for an emailed one. */
function codeFor(email: string): string {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000;
  return String(hash).padStart(6, '0');
}

/** Short, unambiguous invite token, e.g. "J7QM-4KTP". */
function inviteToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRTUVWXY346789';
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}

export class MockBackend implements SyncBackend {
  readonly name = 'On-device demo server';
  readonly isReal = false;
  // The stand-in cannot do a real WebAuthn ceremony, and pretending otherwise
  // would hide the one thing worth testing about passkeys.
  readonly supportsPasskeys = false;

  async currentSession(): Promise<Session | null> {
    return loadSession();
  }

  async signInWithEmail(email: string): Promise<SignInChallenge> {
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      throw new SyncError('That does not look like an email address.', 'invalid');
    }
    // A real backend emails these; the mock hands them back so the flow is
    // testable without an inbox. The code is derived from the address so it
    // stays the same across a reload.
    const token = `email:${address}`;
    return { sent: true, email: address, devLink: token, devCode: codeFor(address) };
  }

  async verifyEmailCode(email: string, code: string): Promise<Session> {
    const address = email.trim().toLowerCase();
    if (code.replace(/\s+/g, '') !== codeFor(address)) {
      throw new SyncError('That code did not work. Check it and try again.', 'auth');
    }
    return this.completeEmailSignIn(`email:${address}`);
  }

  async completeEmailSignIn(token: string): Promise<Session> {
    if (!token.startsWith('email:')) throw new SyncError('That sign-in link is not valid.', 'auth');
    const email = token.slice('email:'.length);
    const session: Session = {
      userId: `user-${email}`,
      displayName: displayNameFromEmail(email),
      email,
      role: roleForEmail(),
      scope: { eventId: null, destinationId: null },
      token,
      expiresAt: null,
      guest: false,
    };
    saveSession(session);
    await server.sessions.put({ ...session, key: session.token });
    return session;
  }

  async joinWithInvite(token: string, displayName: string): Promise<Session> {
    const normalised = token.trim().toUpperCase();
    const invite = (await server.invites.toArray()).find(
      (entry) => entry.token.toUpperCase() === normalised,
    );
    if (!invite) throw new SyncError('That invite code was not recognised.', 'auth');
    if (invite.revokedAt) throw new SyncError('That invite has been revoked.', 'auth');
    if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) {
      throw new SyncError('That invite has expired.', 'auth');
    }
    const name = displayName.trim();
    if (!name) throw new SyncError('Please enter your name so the crew know who you are.', 'invalid');

    const session: Session = {
      userId: `guest-${newId()}`,
      displayName: name,
      email: null,
      role: invite.role,
      scope: invite.scope,
      token: `invite:${invite.token}:${newId()}`,
      expiresAt: invite.expiresAt,
      guest: true,
    };
    saveSession(session);
    await server.sessions.put({ ...session, key: session.token });
    await server.invites.put({ ...invite, usedCount: invite.usedCount + 1 });
    return session;
  }

  async signOut(): Promise<void> {
    saveSession(null);
  }

  async setDisplayName(name: string): Promise<Session> {
    const current = loadSession();
    if (!current) throw new SyncError('Not signed in.', 'auth');
    const next = { ...current, displayName: cleanDisplayName(name) || current.displayName };
    saveSession(next);
    await server.sessions.put({ ...next, key: next.token });
    return next;
  }

  async push(session: Session, changes: ChangeSet): Promise<PushResult> {
    this.assertLive(session);
    const allowed = writableTables(session);
    const result: PushResult = { accepted: 0, stale: 0, refused: 0, conflicts: {} };

    const flat: Array<[TableName, SyncMeta]> = [];
    for (const table of ALL_TABLES) {
      for (const row of changes[table] ?? []) flat.push([table, row]);
    }

    const base = await nextSeq(flat.length);
    let offset = 0;

    for (const [table, row] of flat) {
      // Refuse anything the role may not write, and anything outside its scope.
      if (allowed !== 'all' && !allowed.includes(table)) {
        result.refused += 1;
        continue;
      }
      if (!this.rowInScope(session, table, row)) {
        result.refused += 1;
        continue;
      }

      const key = `${table}:${row.id}`;
      const existing = await server.rows.get(key);
      if (existing && !shouldReplace(existing.row, row)) {
        // The server is ahead; hand its copy back so the client can catch up.
        result.stale += 1;
        (result.conflicts[table] ??= []).push(existing.row);
        continue;
      }

      offset += 1;
      await server.rows.put({ key, table, id: row.id, seq: base + offset, row });
      result.accepted += 1;
    }

    return result;
  }

  async pull(session: Session, cursor: string | null): Promise<PullResult> {
    this.assertLive(session);
    const since = cursor ? Number(cursor) : 0;
    const rows = await server.rows.where('seq').above(since).sortBy('seq');

    const changes: ChangeSet = {};
    let highest = since;
    for (const entry of rows) {
      // A volunteer pulling must not receive the whole warehouse.
      if (!this.rowVisible(session, entry.table, entry.row)) continue;
      (changes[entry.table] ??= []).push(entry.row);
      highest = Math.max(highest, entry.seq);
    }

    return { changes, cursor: String(Math.max(highest, since)), more: false };
  }

  async createInvite(session: Session, input: CreateInviteInput): Promise<Invite> {
    this.assertLive(session);
    if (session.role !== 'admin') {
      throw new SyncError('Only an admin can invite people.', 'permission');
    }
    const days = input.expiresInDays ?? 4;
    const invite: Invite = {
      id: newId(),
      token: inviteToken(),
      role: input.role,
      scope: input.scope,
      label: input.label,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      revokedAt: null,
      usedCount: 0,
    };
    await server.invites.put(invite);
    return invite;
  }

  async listInvites(session: Session): Promise<Invite[]> {
    this.assertLive(session);
    if (session.role !== 'admin') return [];
    return (await server.invites.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeInvite(session: Session, inviteId: string): Promise<void> {
    this.assertLive(session);
    if (session.role !== 'admin') {
      throw new SyncError('Only an admin can revoke an invite.', 'permission');
    }
    const invite = await server.invites.get(inviteId);
    if (invite) await server.invites.put({ ...invite, revokedAt: nowIso() });
  }

  /* --------------------------------------------------------------- guards -- */

  private assertLive(session: Session): void {
    if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
      throw new SyncError('That access has expired. Ask the crew for a new invite.', 'auth');
    }
  }

  /** Scope check for a row being written. */
  private rowInScope(session: Session, table: TableName, row: SyncMeta): boolean {
    if (!session.scope.eventId && !session.scope.destinationId) return true;
    const target = this.targetOf(table, row);
    return inScope(session.scope, target);
  }

  /** Scope check for a row being read. */
  private rowVisible(session: Session, table: TableName, row: SyncMeta): boolean {
    if (!session.scope.eventId && !session.scope.destinationId) return true;
    // Reference data a scoped session still needs to make sense of its packlist.
    if (table === 'items' || table === 'categories') return session.role !== 'volunteer';
    return inScope(session.scope, this.targetOf(table, row));
  }

  /** Pull the event/destination out of whichever row shape this table has. */
  private targetOf(table: TableName, row: SyncMeta): { eventId?: string; destinationId?: string } {
    const record = row as SyncMeta & { eventId?: string; destinationId?: string };
    if (table === 'events') return { eventId: row.id };
    if (table === 'destinations') return { eventId: record.eventId, destinationId: row.id };
    return {
      ...(record.eventId ? { eventId: record.eventId } : {}),
      ...(record.destinationId ? { destinationId: record.destinationId } : {}),
    };
  }
}

/** Wipe the stand-in server. Only used by tests and the reset button. */
export async function resetMockServer(): Promise<void> {
  await Promise.all([server.rows.clear(), server.sessions.clear(), server.invites.clear(), server.meta.clear()]);
  saveSession(null);
}

/** Direct access for tests that need to assert what reached the server. */
export const mockServer = server;
