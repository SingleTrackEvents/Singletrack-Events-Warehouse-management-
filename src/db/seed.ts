import { db, getSettings, SYNCED_TABLES } from './db';
import { alive, create, createMany, liveWhere, softDelete, update } from './repo';
import { CATALOGUE, EVENT_LISTS } from './catalogue';
import { EVENT_SEED } from './eventSeed';
import { EXTRA_ITEMS } from './extrasCatalogue';
import { FOOD_CATALOGUE, FOOD_CATEGORY } from './foodCatalogue';
import { HOUNSLOW_CONSUMPTION, HOUNSLOW_PACKLISTS } from './hounslowSeed';
import { KIT_CONTENTS } from './kitContents';
import { GPT_PACKLISTS, GPT_RETIRED } from './gptSeed';
import { GPT_PLAN_2026 } from './gptSchedule';
import { RCR_CONSUMPTION, RCR_PACKLISTS, RCR_RETIRED } from './rollerCoasterSeed';
import { STATION_TEMPLATES } from './stationTemplates';
import { makeCode } from '../domain/codes';
import { packlistForDestination } from '../domain/packlists';
import type { Destination, Item, RaceVisit, SyncMeta, Unit } from './types';

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
 * The prefix is `stw-`, not the `demo-` the old worked example used, so the two
 * never collide.
 */
export function seedId(kind: string, key: string): string {
  return `stw-${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
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

  // Kit contents resolve by catalogue name to seeded ids, so a kit can be
  // written complete in one go and start at revision 1 like everything else.
  const skuByName = new Map<string, string>();
  for (const group of CATALOGUE) for (const item of group.items) skuByName.set(item.name, item.sku);
  for (const item of FOOD_CATALOGUE) skuByName.set(item.name, item.sku);
  for (const item of EXTRA_ITEMS) skuByName.set(item.name, item.sku);
  const kitContentsFor = (sku: string) => {
    const spec = KIT_CONTENTS.find((entry) => entry.sku === sku);
    if (!spec) return undefined;
    return spec.contents.flatMap(([name, qty]) => {
      const inside = skuByName.get(name);
      return inside ? [{ itemId: seedId('item', inside), qty }] : [];
    });
  };

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
        .map((item) => {
          const contents = kitContentsFor(item.sku);
          return {
            id: seedId('item', item.sku),
            name: item.name,
            sku: item.sku,
            categoryId,
            unit: item.unit as Unit,
            packSize: 1,
            // Where each item lives is warehouse knowledge the spreadsheet does
            // not carry. Left blank rather than guessed, since counting walks
            // the racks in bin order and a wrong bin sends someone to the wrong
            // shelf.
            bin: '',
            qtyOnHand: 0,
            minQty: item.hold,
            barcode: null,
            notes: item.note,
            consumable: item.consumable,
            archived: false,
            ...(contents ? { contents } : {}),
          };
        }),
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
        ...(spec.truckStage ? { truckStage: true } : {}),
      });
    } else if (spec.truckStage) {
      // An event seeded before the truck stage existed gets it once: absent
      // is "never set", while true or false is the crew's choice and stays.
      const existing = await db.events.get(eventId);
      if (existing && !existing.deletedAt && existing.truckStage === undefined) {
        await update(db.events, eventId, { truckStage: true });
      }
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
          day: race.day ?? null,
        });
      } else {
        // A seeded day that was wrong at the time is corrected on a race nobody
        // has touched (still at revision 1). One the crew has edited is theirs.
        const existing = await db.races.get(raceId);
        if (existing && !existing.deletedAt && existing.rev === 1 && (existing.day ?? null) !== (race.day ?? null)) {
          await update(db.races, raceId, { day: race.day ?? null });
        }
      }
    }

    for (const [index, destination] of spec.destinations.entries()) {
      const destinationId = seedId('dest', `${spec.code}-${destination.name}`);
      const raceVisits: RaceVisit[] = (destination.visits ?? [])
        .filter(([race]) => raceIds.has(race))
        .map(([race, passes]) => ({ raceId: raceIds.get(race)!, passes }));
      if (!isNew(destinationId)) {
        // A station seeded before its races were known gets them once:
        // `raceVisits` absent is "never set", while a list, even an empty
        // one, is the crew's and stays.
        const existing = await db.destinations.get(destinationId);
        if (!existing || existing.deletedAt) continue;
        const changes: Partial<Destination> = {};
        if (existing.raceVisits === undefined && raceVisits.length) changes.raceVisits = raceVisits;
        // This edition's plan reaches stations seeded before it, once each:
        // a name still as seeded takes the new one, and a vehicle or schedule
        // nobody has set is filled in. Anything the crew has set is theirs.
        if (destination.title && existing.name === destination.name) {
          changes.name = destination.title;
          // Its list follows the rename while it still carries the old name.
          for (const packlist of alive(await db.packlists.where('destinationId').equals(destinationId).toArray())) {
            if (packlist.name === destination.name) await update(db.packlists, packlist.id, { name: destination.title });
          }
        }
        if (destination.vehicle && !existing.vehicle?.trim()) changes.vehicle = destination.vehicle;
        if (destination.schedule && existing.schedule === undefined) changes.schedule = destination.schedule;
        if (Object.keys(changes).length) await update(db.destinations, destinationId, changes);
        continue;
      }
      await create(db.destinations, {
        id: destinationId,
        eventId,
        name: destination.title ?? destination.name,
        type: destination.type,
        courseKm: destination.courseKm ?? null,
        access: destination.access ?? '2wd',
        accessNotes: destination.accessNotes ?? '',
        lat: null,
        lng: null,
        crewLead: '',
        phone: '',
        // Unknown until someone enters the real hours: a guess on a run sheet
        // reads as a fact.
        openTime: '',
        closeTime: '',
        notes: destination.notes ?? '',
        sort: destination.sort ?? (index + 1) * 10,
        ...(raceVisits.length ? { raceVisits } : {}),
        ...(destination.vehicle ? { vehicle: destination.vehicle } : {}),
        ...(destination.schedule ? { schedule: destination.schedule } : {}),
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

  // A kit seeded before contents existed is topped up here, once: `contents`
  // absent is "never set", while an empty list is the crew's decision. A fresh
  // seed already wrote the kit complete above, so this leaves it alone.
  for (const spec of KIT_CONTENTS) {
    const kit = bySku.get(spec.sku);
    if (!kit) continue;
    // Taken out of the box since it was seeded: gone from a kit that still has
    // it, which nobody would have added back by hand.
    if (kit.contents && spec.removed?.length) {
      const gone = new Set(spec.removed.map((name) => byName.get(name)?.id).filter(Boolean));
      const kept = kit.contents.filter((content) => !gone.has(content.itemId));
      if (kept.length !== kit.contents.length) await update(db.items, kit.id, { contents: kept });
    }
    if (kit.contents !== undefined) continue;
    const contents = spec.contents
      .map(([name, qty]) => ({ itemId: byName.get(name)?.id, qty }))
      .filter((content): content is { itemId: string; qty: number } => Boolean(content.itemId));
    await update(db.items, kit.id, { contents });
  }

  // Roller Coaster Run 2026 starts from its own aid station cards the same way.
  const startingLists = [
    {
      code: 'hc26',
      lists: HOUNSLOW_PACKLISTS,
      retired: [],
      notes: 'Starting quantities from the 2025 aid station run sheets.',
    },
    {
      code: 'rcr26',
      lists: RCR_PACKLISTS,
      retired: RCR_RETIRED,
      notes: 'Starting quantities from the RCR26 Aid Station Cards v2.1.',
    },
    {
      code: 'gpt26',
      lists: GPT_PACKLISTS,
      retired: GPT_RETIRED,
      notes: 'Starting quantities from the GPT 2025 pack list (draft).',
    },
  ];
  /*
   * A newer version of the cards reaches a list already seeded from an older
   * one, but only where nobody has touched it: the list still a draft, the
   * line still at revision 1 and nothing packed against it. A line the crew
   * has edited, or a list already being picked, is theirs.
   */
  const untouched = async (packlistId: string, lineId: string, anyRevision = false) => {
    const list = await db.packlists.get(packlistId);
    const line = await db.packlistLines.get(lineId);
    if (!list || list.deletedAt || list.status !== 'draft') return undefined;
    if (!line || line.deletedAt || line.qtyPacked !== 0) return undefined;
    if (!anyRevision && line.rev !== 1) return undefined;
    return line;
  };
  for (const { code, lists, retired, notes: source } of startingLists) {
    for (const gone of retired) {
      const packlistId = seedId('plist', `${code}-${gone.station}`);
      const lineId = seedId('pline', `${code}-${gone.station}-${gone.item}`);
      if (await untouched(packlistId, lineId)) await softDelete(db.packlistLines, lineId);
    }
    for (const list of lists) {
      // Last year's "Vehicle: VAN #2" is wrong once the station carries this
      // year's vehicle, and the list note is the first thing a volunteer reads.
      const station = await db.destinations.get(seedId('dest', `${code}-${list.station}`));
      const listNotes = station?.vehicle ? (list.notes ?? '').replace(/^Vehicle: [^.]*\.\s*/, '') : list.notes;
      const notes = listNotes ? `${source} ${listNotes}` : source;
      const packlistId = seedId('plist', `${code}-${list.station}`);
      const destinationId = seedId('dest', `${code}-${list.station}`);
      /*
       * A station the crew already keeps its own list for does not get a
       * second one from the seed: the warehouse list would count both, and
       * the event screen only ever opens one. Where the seeded copy already
       * exists beside the crew's working list, it goes, as long as it is
       * still a draft with nothing packed or confirmed against it.
       *
       * A crew list with nothing on it is not a list anyone is keeping: it
       * is what tapping the station, or building packlists from a template
       * that had nothing for it, leaves behind before the seed arrives. A
       * blank draft like that steps aside for the seeded one, so the
       * station opens on the run sheet instead of an empty page.
       */
      let working = await packlistForDestination(destinationId);
      if (
        working &&
        working.id !== packlistId &&
        working.status === 'draft' &&
        !working.notes.trim() &&
        !(await liveWhere(db.packlistLines, 'packlistId', working.id)).length
      ) {
        await softDelete(db.packlists, working.id);
        working = await packlistForDestination(destinationId);
      }
      if (working && working.id !== packlistId) {
        const seeded = await db.packlists.get(packlistId);
        if (seeded && !seeded.deletedAt && seeded.status === 'draft') {
          const seededLines = await liveWhere(db.packlistLines, 'packlistId', packlistId);
          const worked = seededLines.some((line) => line.qtyPacked > 0 || (line.qtyReceived ?? 0) > 0);
          if (!worked) {
            for (const line of seededLines) await softDelete(db.packlistLines, line.id);
            await softDelete(db.packlists, packlistId);
          }
        }
        continue;
      }
      if (!isNew(packlistId)) {
        const existing = await db.packlists.get(packlistId);
        if (existing && !existing.deletedAt && existing.rev === 1 && existing.notes !== notes) {
          await update(db.packlists, packlistId, { notes });
        }
      }
      if (isNew(packlistId)) {
        await create(db.packlists, {
          id: packlistId,
          eventId: seedId('event', code),
          destinationId,
          // A station this year's plan renamed gives its list the new name too.
          name: (code === 'gpt26' && GPT_PLAN_2026[list.station]?.title) || list.station,
          code: makeCode(list.station),
          status: 'draft',
          packedBy: '',
          packedAt: null,
          deliveredAt: null,
          receivedBy: '',
          notes,
        });
      }
      // What the list already carries, by item. A seeded line for an item the
      // crew has already put on the list by hand would be a second line for
      // the same thing, counted twice on the warehouse list.
      const onList = new Map<string, string[]>();
      for (const existing of await liveWhere(db.packlistLines, 'packlistId', packlistId)) {
        onList.set(existing.itemId, [...(onList.get(existing.itemId) ?? []), existing.id]);
      }
      let sort = 10;
      for (const line of list.lines) {
        const lineId = seedId('pline', `${code}-${list.station}-${line.item}`);
        const item = byName.get(line.item);
        const others = item ? (onList.get(item.id) ?? []).filter((id) => id !== lineId) : [];
        if (item && others.length) {
          // The crew's line wins. A seeded copy of it that is still exactly
          // as seeded, with nothing packed, is the duplicate and goes; one
          // somebody has worked on stays, for the crew to sort out.
          const seeded = await untouched(packlistId, lineId, true);
          if (seeded && seeded.qtyRequired === line.qty && seeded.note === (line.note ?? '')) {
            await softDelete(db.packlistLines, lineId);
          }
        } else if (item && isNew(lineId)) {
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
            ...(line.from ? { fromDestinationId: seedId('dest', `${code}-${line.from}`) } : {}),
          });
        } else if (item) {
          const existing = await untouched(packlistId, lineId);
          const from = line.from ? seedId('dest', `${code}-${line.from}`) : null;
          if (
            existing &&
            (existing.qtyRequired !== line.qty ||
              existing.note !== (line.note ?? '') ||
              (existing.fromDestinationId ?? null) !== from)
          ) {
            await update(db.packlistLines, lineId, { qtyRequired: line.qty, note: line.note ?? '', fromDestinationId: from });
          }
        }
        sort += 10;
      }
    }
  }

  // An earlier build seeded one rule per station with ratios derived across
  // both days. Those are retired where nobody has touched them (still at
  // revision 1), so the per-race rules below do not double the plan; an
  // edited rule is the crew's and stays.
  const retired = new Set<string>();
  for (const line of HOUNSLOW_CONSUMPTION) {
    const legacyId = seedId('cline', `hc26-${line.station}-${line.sku}`);
    if (retired.has(legacyId)) continue;
    retired.add(legacyId);
    const legacy = await db.consumptionLines.get(legacyId);
    if (legacy && !legacy.deletedAt && legacy.rev === 1) {
      await softDelete(db.consumptionLines, legacyId);
    }
  }

  // The Roller Coaster Run's food plan comes from its own consumptions sheet.
  const foodPlans = [
    { code: 'hc26', lines: HOUNSLOW_CONSUMPTION },
    { code: 'rcr26', lines: RCR_CONSUMPTION },
  ];
  for (const { code, lines } of foodPlans) {
    let consumptionSort = 10;
    for (const line of lines) {
      const lineId = seedId('cline', `${code}-${line.station}-${line.race}-${line.sku}`);
      const item = bySku.get(line.sku);
      if (item && isNew(lineId)) {
        await create(db.consumptionLines, {
          id: lineId,
          eventId: seedId('event', code),
          destinationId: seedId('dest', `${code}-${line.station}`),
          itemId: item.id,
          perRunner: line.perRunner,
          flatQty: line.flatQty,
          note: '',
          sort: consumptionSort,
          raceId: seedId('race', `${code}-${line.race}`),
        });
      }
      consumptionSort += 10;
    }
  }

  if (!options.onlyMissing) await liftSeedRevisions(previous);
  await clearPlaceholderHours();
}

/**
 * Earlier builds seeded every station open 06:00 to 16:00, which was never
 * anyone's real hours. A seeded station still at its first revision with
 * exactly those hours has never been edited, so the guess is cleared. One
 * that anyone has touched is left as it is.
 */
async function clearPlaceholderHours(): Promise<void> {
  const placeholders = await db.destinations
    .filter(
      (row) =>
        row.id.startsWith('stw-') &&
        row.rev === 1 &&
        !row.deletedAt &&
        row.openTime === '06:00' &&
        row.closeTime === '16:00',
    )
    .toArray();
  for (const row of placeholders) await update(db.destinations, row.id, { openTime: '', closeTime: '' });
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
