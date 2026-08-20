import { ALL_TABLES, db, nowIso } from '../db/db';
import type { TableName } from '../db/db';
import type { SyncMeta } from '../db/types';

/**
 * Backup, handover and restore.
 *
 * Until there is a server, this is how data moves between people: the warehouse
 * exports a file, the driver imports it. Because every row carries `rev` and
 * `updatedAt`, a merge import can resolve conflicts the same way a real sync
 * would — newest revision wins — so two devices can be reconciled after the fact.
 */

export const BACKUP_FORMAT = 'singletrack-warehouse-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  /** Set when the file covers a single event rather than the whole warehouse. */
  eventId?: string;
  label: string;
  tables: Partial<Record<TableName, SyncMeta[]>>;
}

/** Everything on the device, including tombstones so deletes replicate. */
export async function exportAll(label = 'Full backup'): Promise<Backup> {
  const tables: Partial<Record<TableName, SyncMeta[]>> = {};
  for (const name of ALL_TABLES) {
    tables[name] = (await db[name].toArray()) as SyncMeta[];
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: nowIso(), label, tables };
}

/**
 * One event and everything hanging off it, plus the item catalogue the
 * packlists refer to. This is the file you hand to a driver or an aid station
 * lead who only needs their own race.
 */
export async function exportEvent(eventId: string, label = 'Event handover'): Promise<Backup> {
  const [event, destinations, packlists, loads, items, categories, containers] = await Promise.all([
    db.events.get(eventId),
    db.destinations.where('eventId').equals(eventId).toArray(),
    db.packlists.where('eventId').equals(eventId).toArray(),
    db.loads.where('eventId').equals(eventId).toArray(),
    db.items.toArray(),
    db.categories.toArray(),
    db.containers.toArray(),
  ]);

  const packlistIds = new Set(packlists.map((packlist) => packlist.id));
  const loadIds = new Set(loads.map((load) => load.id));
  const [allLines, allStops] = await Promise.all([
    db.packlistLines.toArray(),
    db.loadStops.toArray(),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    eventId,
    label,
    tables: {
      events: event ? [event] : [],
      destinations,
      packlists,
      packlistLines: allLines.filter((line) => packlistIds.has(line.packlistId)),
      containers: containers.filter((container) => packlistIds.has(container.packlistId)),
      loads,
      loadStops: allStops.filter((stop) => loadIds.has(stop.loadId)),
      items,
      categories,
    },
  };
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  tables: string[];
}

export function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Backup>;
  return candidate.format === BACKUP_FORMAT && typeof candidate.tables === 'object';
}

/** Later revision wins; ties fall back to the later `updatedAt`. */
export function shouldReplace(existing: SyncMeta, incoming: SyncMeta): boolean {
  if (incoming.rev !== existing.rev) return incoming.rev > existing.rev;
  return incoming.updatedAt > existing.updatedAt;
}

/**
 * Merge a backup into the local database. Rows the device has never seen are
 * added; rows it has are replaced only when the incoming copy is newer, so
 * importing a stale file can never undo fresher local work.
 */
export async function importBackup(
  backup: Backup,
  mode: 'merge' | 'replace' = 'merge',
): Promise<ImportResult> {
  if (!isBackup(backup)) throw new Error('That file is not a warehouse backup.');
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, tables: [] };

  for (const name of ALL_TABLES) {
    const rows = backup.tables[name];
    if (!rows?.length) continue;
    result.tables.push(name);
    const table = db[name] as unknown as {
      get(id: string): Promise<SyncMeta | undefined>;
      bulkPut(rows: SyncMeta[]): Promise<unknown>;
      clear(): Promise<void>;
    };

    if (mode === 'replace') {
      await table.clear();
      await table.bulkPut(rows);
      result.added += rows.length;
      continue;
    }

    const toWrite: SyncMeta[] = [];
    for (const row of rows) {
      const existing = await table.get(row.id);
      if (!existing) {
        toWrite.push(row);
        result.added += 1;
      } else if (shouldReplace(existing, row)) {
        toWrite.push(row);
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    }
    if (toWrite.length) await table.bulkPut(toWrite);
  }

  return result;
}

/** Wipe every table. Used by "reset device" in settings. */
export async function wipeAll(): Promise<void> {
  for (const name of ALL_TABLES) {
    await db[name].clear();
  }
}

/** Trigger a browser download of a JSON payload. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(rows: string[][], filename: string): void {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  triggerDownload(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), filename);
}

function csvCell(value: string): string {
  const text = value ?? '';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filesystem-safe filename stem from any label. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'export';
}
