import { ALL_TABLES, SYNCED_TABLES, db, nowIso } from '../db/db';
import type { TableName } from '../db/db';
import type { SyncMeta } from '../db/types';
import { shouldReplace } from '../domain/backup';
import { writableTables } from './permissions';
import type { ChangeSet, Session, SyncBackend } from './types';
import { SyncError } from './types';

/**
 * Offline-first sync.
 *
 * The local database is always the source of truth for what is on screen. Sync
 * runs behind it: unsynced rows are pushed when a connection exists, and remote
 * changes are merged in. Nothing in the UI ever waits on the network, because
 * the moment it does the app stops working at the exact places it is needed —
 * a shed with thick walls, a valley with no bars.
 *
 * Conflicts resolve newest-revision-wins, the same rule the file import already
 * uses, so a device that has been offline for a day cannot stomp fresher work
 * just by reconnecting.
 */

const CURSOR_KEY = 'stw.sync.cursor';
const LAST_SYNC_KEY = 'stw.sync.lastAt';
/** Whose cursor it is; see bindCursor. */
const CURSOR_OWNER_KEY = 'stw.sync.cursorOwner';

/** How many rows to push in one request, to keep payloads sane on a bad link. */
const BATCH = 200;

export interface SyncStats {
  pushed: number;
  /** Rows the backend already had a newer copy of. */
  stale: number;
  /** Rows the backend refused because the role may not write them. */
  refused: number;
  pulled: number;
  /** Remote rows discarded because the local copy was newer. */
  ignored: number;
  startedAt: string;
  finishedAt: string;
}

export type SyncPhase = 'idle' | 'pushing' | 'pulling' | 'error' | 'offline';

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

/* ----------------------------------------------------------------- outbox -- */

/**
 * Rows this device has changed and not yet pushed.
 *
 * `syncedAt` is stamped null by every write in the repo layer, which makes the
 * outbox a plain query rather than a second bookkeeping structure that could
 * drift out of step with the data.
 */
export async function collectOutbox(session: Session | null): Promise<ChangeSet> {
  const allowed = writableTables(session);
  const changes: ChangeSet = {};
  for (const table of SYNCED_TABLES) {
    if (allowed !== 'all' && !allowed.includes(table)) continue;
    const rows = (await db[table].toArray()) as SyncMeta[];
    const dirty = rows.filter((row) => row.syncedAt === null).slice(0, BATCH);
    if (dirty.length) changes[table] = dirty;
  }
  return changes;
}

export async function pendingCount(session: Session | null = null): Promise<number> {
  const outbox = await collectOutbox(session);
  return Object.values(outbox).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
}

/**
 * Mark pushed rows as synced — but only those the device has not edited again
 * in the meantime. Comparing revisions before stamping means a change made
 * while the request was in flight stays in the outbox instead of being silently
 * dropped.
 */
async function markSynced(changes: ChangeSet): Promise<void> {
  const at = nowIso();
  for (const [table, rows] of entriesOf(changes)) {
    const current = (await db[table].bulkGet(rows.map((row) => row.id))) as (SyncMeta | undefined)[];
    const settled = rows
      .filter((row, index) => current[index] && current[index]!.rev === row.rev)
      .map((row) => ({ ...row, syncedAt: at }));
    if (settled.length) await (db[table] as unknown as Bulk).bulkPut(settled);
  }
}

/* ------------------------------------------------------------------ merge -- */

/**
 * Apply remote rows, keeping whichever copy of each row is newer. Rows that win
 * are stamped as synced so they do not bounce straight back to the server.
 */
export async function applyRemote(changes: ChangeSet): Promise<{ applied: number; ignored: number }> {
  const at = nowIso();
  let applied = 0;
  let ignored = 0;

  for (const [table, rows] of entriesOf(changes)) {
    const existing = (await db[table].bulkGet(rows.map((row) => row.id))) as (SyncMeta | undefined)[];
    const toWrite: SyncMeta[] = [];
    rows.forEach((row, index) => {
      const local = existing[index];
      if (!local || shouldReplace(local, row)) {
        toWrite.push({ ...row, syncedAt: at });
        applied += 1;
      } else {
        ignored += 1;
      }
    });
    if (toWrite.length) await (db[table] as unknown as Bulk).bulkPut(toWrite);
  }

  return { applied, ignored };
}

/* ------------------------------------------------------------------- run -- */

/**
 * One full sync cycle: push what is waiting, then pull what has changed.
 *
 * Push happens first so this device's work is safe on the server before remote
 * changes are merged locally.
 */
export async function runSync(
  backend: SyncBackend,
  session: Session,
  onPhase?: (phase: SyncPhase) => void,
): Promise<SyncStats> {
  const startedAt = nowIso();
  const stats: SyncStats = {
    pushed: 0, stale: 0, refused: 0, pulled: 0, ignored: 0,
    startedAt, finishedAt: startedAt,
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    onPhase?.('offline');
    throw new SyncError('No connection — changes are queued on this device.', 'network');
  }

  // --- push -------------------------------------------------------------
  onPhase?.('pushing');
  // Loop because the outbox is batched; a device back from a weekend offline
  // may have far more than one batch waiting.
  for (;;) {
    const outbox = await collectOutbox(session);
    const count = Object.values(outbox).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
    if (!count) break;

    const result = await backend.push(session, outbox);
    stats.pushed += result.accepted;
    stats.stale += result.stale;
    stats.refused += result.refused;

    // Whatever the server had that was newer comes back immediately.
    if (Object.keys(result.conflicts).length) {
      const merged = await applyRemote(result.conflicts);
      stats.pulled += merged.applied;
      stats.ignored += merged.ignored;
    }

    await markSynced(outbox);
    // The cursor is not touched here on purpose — see PushResult.

    // A batch that moved nothing forward would loop forever; refused rows are
    // marked synced above so they cannot wedge the queue.
    if (count < BATCH) break;
  }

  // --- pull -------------------------------------------------------------
  onPhase?.('pulling');
  for (;;) {
    const result = await backend.pull(session, getCursor());
    const merged = await applyRemote(result.changes);
    stats.pulled += merged.applied;
    stats.ignored += merged.ignored;
    setCursor(result.cursor);
    if (!result.more) break;
  }

  stats.finishedAt = nowIso();
  setLastSync(stats.finishedAt);
  onPhase?.('idle');
  return stats;
}

/* --------------------------------------------------------------- cursors -- */

export function getCursor(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(CURSOR_KEY);
}

export function setCursor(cursor: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CURSOR_KEY, cursor);
}

export function getLastSync(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LAST_SYNC_KEY);
}

function setLastSync(at: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_SYNC_KEY, at);
}

/**
 * Forget where sync got to, so the next pull starts from the beginning.
 * Used when switching accounts, since the new session may see different rows.
 */
export function resetCursor(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(CURSOR_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
  localStorage.removeItem(CURSOR_OWNER_KEY);
}

/** What the server shows a session: the account, its role and its scope. */
function cursorOwner(session: Session): string {
  return [
    session.userId,
    session.role,
    session.scope.eventId ?? '',
    session.scope.destinationId ?? '',
  ].join('|');
}

/**
 * Tie the cursor to the account that is about to sync with it.
 *
 * The cursor says how far this device has read the server's log, and the
 * server shows each account a different slice of that log. A phone that had
 * synced as a volunteer for one aid station and was then handed to a driver
 * was still parked at the volunteer's position, so every packlist the driver
 * was newly allowed to see, all written before that position, was never
 * pulled. The same happened to anyone whose access changed: a driver made
 * crew, one email account signed in after another. The cursor is now trusted
 * only by the account and scope that set it; anyone else starts from the
 * beginning. Signing back in as the same person keeps it, so nothing is
 * downloaded twice for no reason.
 */
export function bindCursor(session: Session): void {
  if (typeof localStorage === 'undefined') return;
  const owner = cursorOwner(session);
  if (localStorage.getItem(CURSOR_OWNER_KEY) === owner) return;
  resetCursor();
  localStorage.setItem(CURSOR_OWNER_KEY, owner);
}

/**
 * Mark every local row as needing a push. Used after signing in on a device
 * that has been working offline, so nothing already on it is left behind.
 */
export async function markAllDirty(): Promise<number> {
  let total = 0;
  for (const table of ALL_TABLES) {
    const rows = (await db[table].toArray()) as SyncMeta[];
    const dirty = rows.filter((row) => row.syncedAt !== null).map((row) => ({ ...row, syncedAt: null }));
    if (dirty.length) {
      await (db[table] as unknown as Bulk).bulkPut(dirty);
      total += dirty.length;
    }
  }
  return total;
}

/* ------------------------------------------------------------------ util -- */

interface Bulk {
  bulkPut(rows: SyncMeta[]): Promise<unknown>;
}

/** Typed Object.entries over a change set. */
function entriesOf(changes: ChangeSet): Array<[TableName, SyncMeta[]]> {
  return Object.entries(changes).filter(([, rows]) => Boolean(rows?.length)) as Array<
    [TableName, SyncMeta[]]
  >;
}
