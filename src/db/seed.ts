import { db, getSettings, SYNCED_TABLES } from './db';
import { create, createMany, update } from './repo';
import { CATALOGUE, EVENT_LISTS } from './catalogue';
import { EVENT_SEED } from './eventSeed';
import { EXTRA_ITEMS } from './extrasCatalogue';
import { FOOD_CATALOGUE, FOOD_CATEGORY } from './foodCatalogue';
import { HOUNSLOW_CONSUMPTION, HOUNSLOW_PACKLISTS } from './hounslowSeed';
import { STATION_TEMPLATES } from './stationTemplates';
import { makeCode } from '../domain/codes';
import type { Item, RaceVisit, SyncMeta, Unit } from './types';

/**
 * The starting data: SingleTrack's real warehouse catalogue.
 *
 * A new install opens on the actual gear list rather than an empty shell or a
 * made-up example — 180 items across 20 categories, taken from the consolidated
 * inventory spreadsheet, and templates in two shapes.
 *
 * One per event, built from what that event's 2025/26 list actually called for:
 * whole-event totals, good for checking a season against the warehouse. And one
 * per kind of destination — standard station, remote station, village, water
 * drop — which is the shape you want when building a packlist for Aid 3.
 *
 * It also seeds the season's events with their aid stations — dates, locations
 * and station lists compiled from the public race pages and the crew's own
 * operations documents (see eventSeed.ts). Like everything seeded they carry
 * stable ids, so edits stick and a deleted event stays deleted.
 *
 * One thing it deliberately does not do: it records no quantities on hand. The spreadsheet is a picture of what the
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

/**
 * Populate a new database, and top up an old one. Safe to call on every boot.
 *
 * A device that has seeded once used to stop here, which meant anything added
 * to the catalogue afterwards never reached it — the four per-destination
 * templates landed in a release and were invisible to everyone already using
 * the app. So a device that has seeded now also receives whatever this build
 * defines and it has never seen.
 *
 * Never seen is the test, not "not currently there". A record the crew deleted
 * leaves a tombstone behind, and a tombstone is a decision: those ids are known
 * and stay skipped, so nothing resurrects itself overnight. Records that are
 * present are left exactly as they are, edits included.
 */
export async function ensureSeeded(): Promise<void> {
  try {
    const settings = await getSettings();
    if (settings.seeded) {
      await seedStarterData({ onlyMissing: true });
      return;
    }
    const existing = await db.items.count();
    if (existing > 0) {
      await update(db.settings, settings.id, { seeded: true });
      await seedStarterData({ onlyMissing: true });
      return;
    }
    await seedStarterData();
    await update(db.settings, settings.id, { seeded: true, crewName: 'Warehouse' });
  } catch (cause) {
    // A seeding failure must never stop the app from opening.
    console.error('The starting catalogue could not be created', cause);
  }
}

export async function seedStarterData(
  options: { onlyMissing?: boolean } = {},
): Promise<void> {
  // What the seeded rows were at before this run, so a reload outranks a
  // previous removal. See liftSeedRevisions below.
  const previous = await seedRevisions();
  // In top-up mode every id already in the database — tombstoned included — is
  // left alone. A full reload writes over the lot, which is what the button in
  // Settings promises.
  const known = options.onlyMissing ? new Set(previous.keys()) : new Set<string>();
  const isNew = (id: string) => !known.has(id);

  for (const [index, group] of CATALOGUE.entries()) {
    const categoryId = seedId('cat', group.category);
    if (isNew(categoryId)) {
      await create(db.categories, {
        id: categoryId,
        name: group.category,
        sort: (index + 1) * 10,
        icon: group.icon,
      });
    }

    await createMany(
      db.items,
      group.items
        .filter((item) => isNew(seedId('item', item.sku)))
        .map((item) => ({
        id: seedId('item', item.sku),
        name: item.name,
        sku: item.sku,
        categoryId,
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

  }

  // Aid station food and drink, from the consumption planner rather than the
  // inventory sheet the generated catalogue comes from. Same rules: measures
  // become units and pack sizes, the largest event's totals become the
  // low-stock level, and nothing pretends to be a count.
  const foodCategoryId = seedId('cat', FOOD_CATEGORY.name);
  if (isNew(foodCategoryId)) {
    await create(db.categories, {
      id: foodCategoryId,
      name: FOOD_CATEGORY.name,
      sort: (CATALOGUE.length + 1) * 10,
      icon: FOOD_CATEGORY.icon,
    });
  }
  await createMany(
    db.items,
    FOOD_CATALOGUE.filter((item) => isNew(seedId('item', item.sku))).map((item) => ({
      id: seedId('item', item.sku),
      name: item.name,
      sku: item.sku,
      categoryId: foodCategoryId,
      unit: item.unit,
      packSize: item.packSize,
      bin: '',
      qtyOnHand: 0,
      minQty: item.hold,
      barcode: null,
      notes: item.note,
      consumable: true,
      archived: false,
    })),
  );

  // Gear the generated inventory missed, filed into its existing categories.
  await createMany(
    db.items,
    EXTRA_ITEMS.filter((item) => isNew(seedId('item', item.sku))).map((item) => ({
      id: seedId('item', item.sku),
      name: item.name,
      sku: item.sku,
      categoryId: seedId('cat', item.category),
      unit: item.unit,
      packSize: item.packSize,
      bin: '',
      qtyOnHand: 0,
      minQty: item.hold,
      barcode: null,
      notes: item.note,
      consumable: item.consumable,
      archived: false,
    })),
  );

  // Built from the database rather than from what this run happened to write,
  // so a template line still finds its item when the item was already present.
  const bySku = new Map<string, Item>();
  for (const item of (await db.items.toArray()) as Item[]) bySku.set(item.sku, item);

  // One template per event, from that event's own packing list.
  for (const event of EVENT_LISTS) {
    const lines = CATALOGUE.flatMap((group) =>
      group.items
        .filter((item) => (item.needs[event.code] ?? 0) > 0)
        .map((item) => ({ item, qty: item.needs[event.code] })),
    );
    if (!lines.length) continue;

    const templateId = seedId('tpl', event.code);
    if (!isNew(templateId)) continue;
    const template = await create(db.templates, {
      id: templateId,
      name: `${event.name} — full event`,
      // These are whole-event totals rather than one site's worth, so the
      // village is where they land before being split out to the stations.
      appliesTo: 'event_village',
      scope: 'event' as const,
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

  // One per kind of destination, for building a packlist a station at a time.
  for (const spec of STATION_TEMPLATES) {
    const templateId = seedId('tpl', spec.name);
    if (!isNew(templateId)) continue;
    const template = await create(db.templates, {
      id: templateId,
      name: spec.name,
      appliesTo: spec.appliesTo,
      scope: 'site' as const,
      suitsAccess: spec.suitsAccess,
      description: spec.description,
    });

    await createMany(
      db.templateLines,
      // A line whose item is missing is dropped rather than left pointing at
      // nothing; a test keeps the two in step so this should never fire.
      spec.lines
        .filter(([sku]) => bySku.has(sku))
        .map(([sku, qty, mandatory], order) => ({
          id: seedId('tline', `${spec.name}-${sku}`),
          templateId: template.id,
          itemId: bySku.get(sku)!.id,
          qty,
          mandatory: mandatory ?? false,
          perRunner: false,
          note: '',
          sort: (order + 1) * 10,
        })),
    );
  }

  // The season's events, each with its aid stations and races. Status defaults
  // to planning; dates and stations are the crew's to correct as the season
  // firms up, which is why nothing here ever overwrites an existing row.
  for (const spec of EVENT_SEED) {
    const eventId = seedId('event', spec.code);
    if (isNew(eventId)) {
      await create(db.events, {
        id: eventId,
        name: spec.name,
        location: spec.location,
        startDate: spec.startDate,
        endDate: spec.endDate,
        status: spec.status ?? 'planning',
        notes: spec.notes ?? '',
      });
    }

    // Race name → seeded id, so station links can be spelled by name above.
    const raceIds = new Map<string, string>();
    for (const [index, race] of (spec.races ?? []).entries()) {
      const raceId = seedId('race', `${spec.code}-${race.name}`);
      raceIds.set(race.name, raceId);
      if (isNew(raceId)) {
        await create(db.races, {
          id: raceId,
          eventId,
          name: race.name,
          projection: race.projection,
          sort: (index + 1) * 10,
        });
      }
    }

    for (const [index, destination] of spec.destinations.entries()) {
      const destinationId = seedId('dest', `${spec.code}-${destination.name}`);
      if (!isNew(destinationId)) continue;
      const raceVisits: RaceVisit[] = (destination.visits ?? [])
        .filter(([race]) => raceIds.has(race))
        .map(([race, passes]) => ({ raceId: raceIds.get(race)!, passes }));
      await create(db.destinations, {
        id: destinationId,
        eventId,
        name: destination.name,
        type: destination.type,
        courseKm: destination.courseKm ?? null,
        access: destination.access ?? '2wd',
        accessNotes: destination.accessNotes ?? '',
        lat: null,
        lng: null,
        crewLead: '',
        phone: '',
        openTime: '06:00',
        closeTime: '16:00',
        notes: destination.notes ?? '',
        sort: (index + 1) * 10,
        ...(raceVisits.length ? { raceVisits } : {}),
      });
    }
  }

  // Hounslow 2026 starts further along than the rest of the season: last
  // year's run sheets become each station's draft packlist, and the
  // consumption planner becomes its food plan. Both are starting points the
  // crew corrects — nothing here is ever marked packed and no stock moves.
  const byName = new Map<string, Item>();
  for (const item of (await db.items.toArray()) as Item[]) {
    if (!item.deletedAt) byName.set(item.name, item);
  }
  const hounslowId = seedId('event', 'hc26');

  for (const list of HOUNSLOW_PACKLISTS) {
    const packlistId = seedId('plist', `hc26-${list.station}`);
    if (isNew(packlistId)) {
      await create(db.packlists, {
        id: packlistId,
        eventId: hounslowId,
        destinationId: seedId('dest', `hc26-${list.station}`),
        name: list.station,
        code: makeCode(list.station),
        status: 'draft',
        packedBy: '',
        packedAt: null,
        deliveredAt: null,
        receivedBy: '',
        notes: 'Starting quantities from the 2025 aid station run sheets.',
      });
    }
    let sort = 10;
    for (const line of list.lines) {
      const lineId = seedId('pline', `hc26-${list.station}-${line.item}`);
      const item = byName.get(line.item);
      if (item && isNew(lineId)) {
        await create(db.packlistLines, {
          id: lineId,
          packlistId,
          itemId: item.id,
          qtyRequired: line.qty,
          qtyPacked: 0,
          qtyReturned: 0,
          mandatory: false,
          containerId: null,
          note: line.note ?? '',
          sort,
        });
      }
      sort += 10;
    }
  }

  let consumptionSort = 10;
  for (const line of HOUNSLOW_CONSUMPTION) {
    const lineId = seedId('cline', `hc26-${line.station}-${line.sku}`);
    const item = bySku.get(line.sku);
    if (item && isNew(lineId)) {
      await create(db.consumptionLines, {
        id: lineId,
        eventId: hounslowId,
        destinationId: seedId('dest', `hc26-${line.station}`),
        itemId: item.id,
        perRunner: line.perRunner,
        flatQty: line.flatQty,
        note: '',
        sort: consumptionSort,
      });
    }
    consumptionSort += 10;
  }

  if (!options.onlyMissing) await liftSeedRevisions(previous);
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
