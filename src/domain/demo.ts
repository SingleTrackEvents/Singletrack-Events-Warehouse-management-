import { db, SYNCED_TABLES } from '../db/db';
import { alive, softDelete } from '../db/repo';
import { isDemoId } from '../db/seed';
import type { Table } from 'dexie';
import type { SyncMeta } from '../db/types';

/**
 * Removing the worked example.
 *
 * The demo data exists so the app is usable the moment it opens, but once a
 * crew has entered real races it is clutter — and on a shared account it is
 * clutter on everybody's phone.
 *
 * So removal has to be a real deletion rather than a local one. Every demo row
 * is tombstoned through the repo layer, which queues it for sync like any other
 * change: the deletion then reaches every signed-in device instead of the demo
 * coming straight back on the next pull. It also settles the case of a new
 * device seeding its own copy at first boot — the tombstone carries the higher
 * revision, so the seeded rows are removed as soon as it syncs.
 */

/** Records the demo seed created, and what of yours points at them. */
export interface DemoFootprint {
  /** Live demo rows across every table. */
  records: number;
  /** Demo events still present, which is what the crew actually recognises. */
  events: number;
  items: number;
  templates: number;
  /**
   * Rows you created that refer to a demo record — a packlist line against a
   * demo item, say. Removing the demo leaves these pointing at nothing, so the
   * confirmation says how many there are rather than discovering it later.
   */
  yourRecordsAffected: number;
}

/** Every live demo row, table by table. */
async function demoRows(): Promise<Array<{ table: (typeof SYNCED_TABLES)[number]; row: SyncMeta }>> {
  const found: Array<{ table: (typeof SYNCED_TABLES)[number]; row: SyncMeta }> = [];
  for (const name of SYNCED_TABLES) {
    const rows = alive((await db[name].toArray()) as SyncMeta[]);
    for (const row of rows) {
      if (isDemoId(row.id)) found.push({ table: name, row });
    }
  }
  return found;
}

export async function demoFootprint(): Promise<DemoFootprint> {
  const rows = await demoRows();
  const demoIds = new Set(rows.map((entry) => entry.row.id));

  // Anything of yours holding a demo id in a reference column.
  const references = async <T extends SyncMeta>(
    table: T[],
    keys: Array<keyof T>,
  ): Promise<number> =>
    alive(table).filter(
      (row) => !isDemoId(row.id) && keys.some((key) => demoIds.has(String(row[key] ?? ''))),
    ).length;

  const yourRecordsAffected =
    (await references(await db.destinations.toArray(), ['eventId'])) +
    (await references(await db.packlists.toArray(), ['eventId', 'destinationId'])) +
    (await references(await db.packlistLines.toArray(), ['packlistId', 'itemId'])) +
    (await references(await db.containers.toArray(), ['packlistId'])) +
    (await references(await db.templateLines.toArray(), ['templateId', 'itemId'])) +
    (await references(await db.stocktakeCounts.toArray(), ['itemId'])) +
    (await references(await db.movements.toArray(), ['itemId'])) +
    (await references(await db.loadStops.toArray(), ['loadId', 'destinationId'])) +
    (await references(await db.items.toArray(), ['categoryId']));

  return {
    records: rows.length,
    events: rows.filter((entry) => entry.table === 'events').length,
    items: rows.filter((entry) => entry.table === 'items').length,
    templates: rows.filter((entry) => entry.table === 'templates').length,
    yourRecordsAffected,
  };
}

/** Tombstone every demo record so the removal reaches the whole crew. */
export async function removeDemoData(): Promise<number> {
  const rows = await demoRows();
  for (const { table, row } of rows) {
    // db[table] is a union of fifteen differently-typed tables; the sync engine
    // narrows it the same way, since every row is a SyncMeta at this level.
    await softDelete(db[table] as unknown as Table<SyncMeta, string>, row.id);
  }
  return rows.length;
}
