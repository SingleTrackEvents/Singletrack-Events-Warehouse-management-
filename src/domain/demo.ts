import { db, SYNCED_TABLES } from '../db/db';
import { alive, softDelete } from '../db/repo';
import { demoSignature, isDemoId } from '../db/seed';
import type { Table } from 'dexie';
import type { Item, RaceEvent, SyncMeta, Template } from '../db/types';

/**
 * Removing the worked example.
 *
 * The demo data exists so the app is usable the moment it opens, but once a
 * crew has entered real races it is clutter — and on a shared account it is
 * clutter on everybody's phone.
 *
 * Removal has to be a real deletion rather than a local one. Every matched row
 * is tombstoned through the repo layer, which queues it for sync like any other
 * change: the deletion then reaches every signed-in device instead of the demo
 * coming straight back on the next pull. It also settles the case of a new
 * device seeding its own copy at first boot — the tombstone carries the higher
 * revision, so the seeded rows go as soon as it syncs.
 *
 * Finding the rows takes two passes. Ids beginning `demo-` are unambiguous, but
 * databases seeded before those ids became deterministic carry random UUIDs, so
 * the catalogue is also matched on the SKUs and names the seed uses. Those are
 * invented codes and a match is about as certain as this can get.
 *
 * The example races are handled apart from all of that. They are named after
 * real SingleTrack events, and a crew may well have adopted the demo copy as
 * their own and hung a season's work off it. Nothing here decides that: the
 * races are reported separately and removed only when explicitly asked for, one
 * at a time.
 */

/** An example race that may or may not be the crew's real one. */
export interface DemoEventCandidate {
  event: RaceEvent;
  /** True when the id proves it came from the seed. */
  certain: boolean;
  destinations: number;
  packlists: number;
  /** Packing actually recorded against it — the sign of real use. */
  packedLines: number;
}

export interface DemoFootprint {
  /** Catalogue, templates and categories that came from the seed. */
  catalogue: number;
  items: number;
  templates: number;
  categories: number;
  /** Example races, each needing a human decision. */
  events: DemoEventCandidate[];
  /** True when nothing at all was matched. */
  empty: boolean;
}

type Named = SyncMeta & { name?: string; sku?: string };

function matchesCatalogue(table: string, row: Named): boolean {
  if (isDemoId(row.id)) return true;
  const signature = demoSignature();
  const name = (row.name ?? '').trim().toLowerCase();
  if (table === 'items') return signature.itemSkus.has((row.sku ?? '').trim().toLowerCase());
  if (table === 'categories') return signature.categoryNames.has(name);
  if (table === 'templates') return signature.templateNames.has(name);
  return false;
}

/** Catalogue-side rows: items, categories, templates and the lines under them. */
async function catalogueRows(): Promise<Array<{ table: (typeof SYNCED_TABLES)[number]; id: string }>> {
  const found: Array<{ table: (typeof SYNCED_TABLES)[number]; id: string }> = [];

  const items = alive((await db.items.toArray()) as Item[]).filter((row) =>
    matchesCatalogue('items', row),
  );
  const categories = alive(await db.categories.toArray()).filter((row) =>
    matchesCatalogue('categories', row),
  );
  const templates = alive((await db.templates.toArray()) as Template[]).filter((row) =>
    matchesCatalogue('templates', row),
  );

  for (const row of items) found.push({ table: 'items', id: row.id });
  for (const row of categories) found.push({ table: 'categories', id: row.id });
  for (const row of templates) found.push({ table: 'templates', id: row.id });

  // Template lines belong to their template; a line without one is an orphan.
  const templateIds = new Set(templates.map((row) => row.id));
  for (const line of alive(await db.templateLines.toArray())) {
    if (templateIds.has(line.templateId)) found.push({ table: 'templateLines', id: line.id });
  }

  // Seeded opening-stock movements, which only ever carry a demo id.
  for (const movement of alive(await db.movements.toArray())) {
    if (isDemoId(movement.id)) found.push({ table: 'movements', id: movement.id });
  }

  return found;
}

/** Every row hanging off one event, the event included. */
async function eventRows(
  eventId: string,
): Promise<Array<{ table: (typeof SYNCED_TABLES)[number]; id: string }>> {
  const found: Array<{ table: (typeof SYNCED_TABLES)[number]; id: string }> = [
    { table: 'events', id: eventId },
  ];
  const destinations = alive(await db.destinations.toArray()).filter(
    (row) => row.eventId === eventId,
  );
  const packlists = alive(await db.packlists.toArray()).filter((row) => row.eventId === eventId);
  const packlistIds = new Set(packlists.map((row) => row.id));
  const loads = alive(await db.loads.toArray()).filter((row) => row.eventId === eventId);
  const loadIds = new Set(loads.map((row) => row.id));

  for (const row of destinations) found.push({ table: 'destinations', id: row.id });
  for (const row of packlists) found.push({ table: 'packlists', id: row.id });
  for (const row of loads) found.push({ table: 'loads', id: row.id });
  for (const row of alive(await db.packlistLines.toArray())) {
    if (packlistIds.has(row.packlistId)) found.push({ table: 'packlistLines', id: row.id });
  }
  for (const row of alive(await db.containers.toArray())) {
    if (packlistIds.has(row.packlistId)) found.push({ table: 'containers', id: row.id });
  }
  for (const row of alive(await db.loadStops.toArray())) {
    if (loadIds.has(row.loadId)) found.push({ table: 'loadStops', id: row.id });
  }
  return found;
}

/** Races that look like the seeded examples, with what is hanging off each. */
export async function demoEventCandidates(): Promise<DemoEventCandidate[]> {
  const signature = demoSignature();
  const events = alive((await db.events.toArray()) as RaceEvent[]).filter(
    (event) => isDemoId(event.id) || signature.eventNames.has(event.name.trim().toLowerCase()),
  );

  const destinations = alive(await db.destinations.toArray());
  const packlists = alive(await db.packlists.toArray());
  const lines = alive(await db.packlistLines.toArray());

  return events.map((event) => {
    const own = packlists.filter((packlist) => packlist.eventId === event.id);
    const ownIds = new Set(own.map((packlist) => packlist.id));
    return {
      event,
      certain: isDemoId(event.id),
      destinations: destinations.filter((row) => row.eventId === event.id).length,
      packlists: own.length,
      packedLines: lines.filter((line) => ownIds.has(line.packlistId) && line.qtyPacked > 0).length,
    };
  });
}

export async function demoFootprint(): Promise<DemoFootprint> {
  const rows = await catalogueRows();
  const events = await demoEventCandidates();
  const count = (table: string) => rows.filter((row) => row.table === table).length;
  return {
    catalogue: rows.length,
    items: count('items'),
    templates: count('templates'),
    categories: count('categories'),
    events,
    empty: rows.length === 0 && events.length === 0,
  };
}

async function tombstone(
  rows: Array<{ table: (typeof SYNCED_TABLES)[number]; id: string }>,
): Promise<number> {
  for (const { table, id } of rows) {
    // db[table] is a union of fifteen differently-typed tables; the sync engine
    // narrows it the same way, since every row is a SyncMeta at this level.
    await softDelete(db[table] as unknown as Table<SyncMeta, string>, id);
  }
  return rows.length;
}

/** Remove the demo catalogue, templates and seeded opening stock. */
export async function removeDemoCatalogue(): Promise<number> {
  return tombstone(await catalogueRows());
}

/**
 * Remove one example race and everything under it.
 *
 * Stock movements are left alone, as they are everywhere else: the ledger is
 * the record of what physically left the warehouse.
 */
export async function removeDemoEvent(eventId: string): Promise<number> {
  return tombstone(await eventRows(eventId));
}
