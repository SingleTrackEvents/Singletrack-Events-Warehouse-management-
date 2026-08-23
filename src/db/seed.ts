import { db, getSettings, SYNCED_TABLES } from './db';
import { create, createMany, update } from './repo';
import { CATALOGUE, EVENT_LISTS } from './catalogue';
import type { Item, SyncMeta, Unit } from './types';

/**
 * The starting data: SingleTrack's real warehouse catalogue.
 *
 * A new install opens on the actual gear list rather than an empty shell or a
 * made-up example — 180 items across 20 categories, taken from the consolidated
 * inventory spreadsheet, plus one packing template per event built from what
 * that event's 2025/26 list actually called for.
 *
 * Two things it deliberately does not do.
 *
 * It creates no events. Those are the crew's to enter, and an event carries
 * dates and destinations that no import can know.
 *
 * It records no quantities on hand. The spreadsheet is a picture of what the
 * packing lists say, not a physical count — its own notes say so. Inventing a
 * figure here would put a number in front of someone that looks like a stocktake
 * and is not one. Every item starts at zero on hand with its low-stock level set
 * to the largest single-event requirement, so the catalogue reads as "not yet
 * counted" until somebody walks the racks. That is what the stocktake is for.
 */

/**
 * A stable id for a seeded record.
 *
 * Two phones each seed their own copy and sync then merges both, which would
 * double every item and template. Deriving the ids from the content makes the
 * two copies the same rows, so they collapse into one set.
 *
 * The prefix is `stw-`, not the `demo-` the old worked example used: the demo
 * removal tool matches that prefix, and sharing it would have pointed the tool
 * at the real warehouse.
 */
export function seedId(kind: string, key: string): string {
  return `stw-${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** True for anything the old worked-example seed created. */
export function isDemoId(id: string): boolean {
  return id.startsWith('demo-');
}

/** Populate an empty database. Safe to call on every boot — it exits if seeded. */
export async function ensureSeeded(): Promise<void> {
  try {
    const settings = await getSettings();
    if (settings.seeded) return;
    const existing = await db.items.count();
    if (existing > 0) {
      await update(db.settings, settings.id, { seeded: true });
      return;
    }
    await seedStarterData();
    await update(db.settings, settings.id, { seeded: true, crewName: 'Warehouse' });
  } catch (cause) {
    // A seeding failure must never stop the app from opening.
    console.error('The starting catalogue could not be created', cause);
  }
}

export async function seedStarterData(): Promise<void> {
  // What the seeded rows were at before this run, so a reload outranks a
  // previous removal. See liftSeedRevisions below.
  const previous = await seedRevisions();
  const bySku = new Map<string, Item>();

  for (const [index, group] of CATALOGUE.entries()) {
    const category = await create(db.categories, {
      id: seedId('cat', group.category),
      name: group.category,
      sort: (index + 1) * 10,
      icon: group.icon,
    });

    const items = await createMany(
      db.items,
      group.items.map((item) => ({
        id: seedId('item', item.sku),
        name: item.name,
        sku: item.sku,
        categoryId: category.id,
        unit: item.unit as Unit,
        packSize: 1,
        // Where each item lives is warehouse knowledge the spreadsheet does not
        // carry. Left blank rather than guessed, since counting walks the racks
        // in bin order and a wrong bin sends someone to the wrong shelf.
        bin: '',
        qtyOnHand: 0,
        minQty: item.hold,
        barcode: null,
        notes: item.note,
        consumable: item.consumable,
        archived: false,
      })),
    );

    for (const item of items) bySku.set(item.sku, item);
  }

  // One template per event, from that event's own packing list.
  for (const event of EVENT_LISTS) {
    const lines = CATALOGUE.flatMap((group) =>
      group.items
        .filter((item) => (item.needs[event.code] ?? 0) > 0)
        .map((item) => ({ item, qty: item.needs[event.code] })),
    );
    if (!lines.length) continue;

    const template = await create(db.templates, {
      id: seedId('tpl', event.code),
      name: `${event.name} — full event`,
      // These are whole-event totals rather than one site's worth, so the
      // village is where they land before being split out to the stations.
      appliesTo: 'event_village',
      description:
        `Everything the ${event.year} ${event.name} list called for, across all aid stations and ` +
        'the village combined. Split it across destinations as you build them.',
    });

    await createMany(
      db.templateLines,
      lines.map(({ item, qty }, order) => ({
        id: seedId('tline', `${event.code}-${item.sku}`),
        templateId: template.id,
        itemId: bySku.get(item.sku)?.id ?? seedId('item', item.sku),
        qty,
        mandatory: false,
        perRunner: false,
        note: '',
        sort: (order + 1) * 10,
      })),
    );
  }

  await liftSeedRevisions(previous);
}

/** Current revision of every seeded row, tombstoned ones included. */
async function seedRevisions(): Promise<Map<string, number>> {
  const revisions = new Map<string, number>();
  for (const name of SYNCED_TABLES) {
    for (const row of (await db[name].toArray()) as SyncMeta[]) {
      if (row.id.startsWith('stw-')) revisions.set(row.id, row.rev);
    }
  }
  return revisions;
}

/**
 * Make a reload outrank whatever it replaced.
 *
 * Seeding writes fresh records at revision 1. That is fine on an empty device,
 * but reloading the catalogue after removing it leaves the server holding a
 * tombstone at a higher revision — and newest-revision-wins would then delete
 * the reloaded rows on the next sync, so the catalogue would reappear and
 * quietly vanish again. Lifting each row above the revision it had makes the
 * reload the newer fact, which is what the person tapping the button meant.
 */
async function liftSeedRevisions(previous: Map<string, number>): Promise<void> {
  if (!previous.size) return;
  for (const name of SYNCED_TABLES) {
    const rows = (await db[name].toArray()) as SyncMeta[];
    const lifted = rows.filter((row) => {
      const was = previous.get(row.id);
      return was !== undefined && row.rev <= was;
    });
    if (!lifted.length) continue;
    await (db[name] as unknown as { bulkPut(rows: SyncMeta[]): Promise<unknown> }).bulkPut(
      lifted.map((row) => ({ ...row, rev: (previous.get(row.id) ?? 0) + 1, syncedAt: null })),
    );
  }
}
