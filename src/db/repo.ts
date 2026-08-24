import type { Table } from 'dexie';
import { db, nowIso, stampNew, stampUpdate } from './db';
import type { TableName } from './db';
import { currentSession } from '../sync/current';
import { scrubChanges } from '../sync/permissions';
import type { SyncMeta } from './types';

/**
 * Thin CRUD helpers over Dexie that keep sync metadata correct.
 *
 * Nothing in the app writes to a table directly — going through here guarantees
 * `rev`, `updatedAt` and `deviceId` are always stamped, and that deletes are
 * soft so a future sync can replicate them as tombstones.
 */

/** Insert a record, filling in id/timestamps. Pass any known fields. */
export async function create<T extends SyncMeta>(
  table: Table<T, string>,
  data: Omit<T, keyof SyncMeta> & Partial<SyncMeta>,
): Promise<T> {
  const record = { ...stampNew(), ...data } as T;
  await table.put(record);
  return record;
}

/** Insert many records in one transaction. */
export async function createMany<T extends SyncMeta>(
  table: Table<T, string>,
  rows: Array<Omit<T, keyof SyncMeta> & Partial<SyncMeta>>,
): Promise<T[]> {
  const records = rows.map((row) => ({ ...stampNew(), ...row }) as T);
  await table.bulkPut(records);
  return records;
}

/** Merge changes into a record and bump its revision. */
export async function update<T extends SyncMeta>(
  table: Table<T, string>,
  id: string,
  changes: Partial<Omit<T, keyof SyncMeta>>,
): Promise<T | undefined> {
  const existing = await table.get(id);
  if (!existing) return undefined;
  // Anything the signed-in role may not write is dropped here rather than at
  // push time: once a forbidden value is in the local database it is already
  // what this device believes, and a later sync would spread it.
  const permitted = scrubChanges(currentSession(), table.name as TableName, changes);
  if (!Object.keys(permitted).length) return existing;
  const next = stampUpdate({ ...existing, ...permitted }) as T;
  await table.put(next);
  return next;
}

/** Tombstone a record. It stays in the database so a sync can replicate it. */
export async function softDelete<T extends SyncMeta>(
  table: Table<T, string>,
  id: string,
): Promise<void> {
  const existing = await table.get(id);
  if (!existing || existing.deletedAt) return;
  await table.put(stampUpdate({ ...existing, deletedAt: nowIso() }) as T);
}

/** Undo a soft delete. */
export async function restore<T extends SyncMeta>(
  table: Table<T, string>,
  id: string,
): Promise<void> {
  const existing = await table.get(id);
  if (!existing || !existing.deletedAt) return;
  await table.put(stampUpdate({ ...existing, deletedAt: null }) as T);
}

/** Drop tombstoned rows from a result set. */
export function alive<T extends SyncMeta>(rows: T[]): T[] {
  return rows.filter((row) => !row.deletedAt);
}

/** All live rows in a table. */
export async function liveAll<T extends SyncMeta>(table: Table<T, string>): Promise<T[]> {
  return alive(await table.toArray());
}

/**
 * Live rows matching an indexed field, e.g. every line on a packlist.
 * Sorted by `sort` when the records carry one.
 */
export async function liveWhere<T extends SyncMeta>(
  table: Table<T, string>,
  index: string,
  value: string,
): Promise<T[]> {
  const rows = alive(await table.where(index).equals(value).toArray());
  return sortBySort(rows);
}

/** Order by a numeric `sort` field where present, falling back to creation order. */
export function sortBySort<T extends SyncMeta>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = (a as T & { sort?: number }).sort;
    const sb = (b as T & { sort?: number }).sort;
    if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** Next `sort` value for appending to an ordered list. */
export function nextSort(rows: Array<{ sort?: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.sort ?? 0), 0) + 10;
}

/** Soft-delete every child row pointing at a parent, e.g. lines of a packlist. */
export async function softDeleteChildren<T extends SyncMeta>(
  table: Table<T, string>,
  index: string,
  value: string,
): Promise<void> {
  const rows = await table.where(index).equals(value).toArray();
  const at = nowIso();
  const tombstoned = rows
    .filter((row) => !row.deletedAt)
    .map((row) => stampUpdate({ ...row, deletedAt: at }) as T);
  if (tombstoned.length) await table.bulkPut(tombstoned);
}

/** Convenience: index rows by id for quick joins in the UI. */
export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export { db };
