import { describe, expect, it } from 'vitest';
import { db, SYNCED_TABLES } from '../db/db';
import { alive, create, softDelete } from '../db/repo';
import { seedStarterData } from '../db/seed';
import {
  LEGACY_DEMO_CATEGORIES,
  LEGACY_DEMO_EVENTS,
  LEGACY_DEMO_SKUS,
  LEGACY_DEMO_TEMPLATES,
} from '../db/legacyDemo';
import { collectOutbox, getCursor, pendingCount, setCursor } from '../sync/engine';
import { demoFootprint, removeDemoCatalogue, removeDemoEvent } from './demo';
import { wipeAll } from './backup';
import type { SyncMeta } from '../db/types';

const rowsOf = async (name: (typeof SYNCED_TABLES)[number]) =>
  (await db[name].toArray()) as SyncMeta[];

const bulk = (name: (typeof SYNCED_TABLES)[number]) =>
  db[name] as unknown as { bulkPut(rows: SyncMeta[]): Promise<unknown> };

/**
 * Recreate what the old worked-example seed left behind.
 *
 * The seed itself now loads the real warehouse catalogue, so it can no longer
 * stand in for the demo — and it must not, since the whole point is that the
 * removal tool tells the two apart.
 */
async function seedLegacyDemo({ randomIds = false } = {}) {
  const id = (kind: string, key: string) =>
    randomIds
      ? crypto.randomUUID()
      : `demo-${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  for (const [index, name] of LEGACY_DEMO_CATEGORIES.entries()) {
    await create(db.categories, { id: id('cat', name), name, sort: index * 10, icon: '📦' });
  }
  for (const sku of LEGACY_DEMO_SKUS) {
    await create(db.items, {
      id: id('item', sku), name: `Demo ${sku}`, sku, categoryId: null, unit: 'each',
      packSize: 1, bin: 'A1', qtyOnHand: 10, minQty: 2, barcode: null, notes: '',
      consumable: false, archived: false,
    });
  }
  for (const name of LEGACY_DEMO_TEMPLATES) {
    const template = await create(db.templates, {
      id: id('tpl', name), name, appliesTo: 'aid_station' as const, description: '',
    });
    await create(db.templateLines, {
      id: id('tline', name), templateId: template.id, itemId: 'x', qty: 1,
      mandatory: false, perRunner: false, note: '', sort: 10,
    });
  }
  for (const name of LEGACY_DEMO_EVENTS) {
    const event = await create(db.events, {
      id: id('event', name), name, location: 'Somewhere, VIC', startDate: '2026-09-05',
      endDate: '2026-09-05', status: 'packing' as const, notes: '',
    });
    // Only the first race gets sites and packing, so the tests can tell the
    // "clearly untouched" case from the "someone has been using this" one.
    if (name !== LEGACY_DEMO_EVENTS[0]) continue;
    for (const site of ['Aid 1', 'Aid 2']) {
      const destination = await create(db.destinations, {
        id: id('dest', `${name}-${site}`), eventId: event.id, name: site,
        type: 'aid_station' as const, courseKm: 10, access: '4wd' as const, accessNotes: '',
        lat: null, lng: null, crewLead: '', phone: '', openTime: '07:00', closeTime: '16:00',
        notes: '', sort: 10,
      });
      const packlist = await create(db.packlists, {
        id: id('pl', `${name}-${site}`), eventId: event.id, destinationId: destination.id,
        name: site, code: `A${site.length}-7K2M`, status: 'packed' as const, packedBy: 'Sam',
        packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
      });
      await create(db.packlistLines, {
        id: id('plline', `${name}-${site}`), packlistId: packlist.id, itemId: 'x',
        qtyRequired: 4, qtyPacked: 4, qtyReturned: 0, mandatory: false, containerId: null,
        note: '', sort: 10,
      });
    }
    await create(db.loads, {
      id: id('load', name), eventId: event.id, name: 'Run 1', vehicle: 'Hilux', driver: 'Kate', phone: '',
      status: 'planned' as const, departAt: null, departedAt: null, completedAt: null, notes: '',
    });
  }
}

async function markAllSynced() {
  const now = new Date().toISOString();
  for (const name of SYNCED_TABLES) {
    const rows = await rowsOf(name);
    if (rows.length) await bulk(name).bulkPut(rows.map((row) => ({ ...row, syncedAt: now })));
  }
}

describe('finding the demo data', () => {
  it('finds it by id on a freshly seeded database', async () => {
    await seedLegacyDemo();

    const footprint = await demoFootprint();
    expect(footprint.items).toBeGreaterThan(40);
    expect(footprint.templates).toBeGreaterThan(0);
    expect(footprint.categories).toBeGreaterThan(0);
    expect(footprint.events).toHaveLength(3);
    expect(footprint.events.every((entry) => entry.certain)).toBe(true);
    expect(footprint.empty).toBe(false);
  });

  it('still finds it when the ids are random, as on older databases', async () => {
    await seedLegacyDemo();
    const before = await demoFootprint();
    await db.delete();
    await db.open();
    await seedLegacyDemo({ randomIds: true });

    // The whole point: this used to report nothing at all and tell the crew
    // their demo data was already gone while it sat there in front of them.
    const footprint = await demoFootprint();
    expect(footprint.items).toBe(before.items);
    expect(footprint.templates).toBe(before.templates);
    expect(footprint.categories).toBe(before.categories);
    expect(footprint.events).toHaveLength(3);
    expect(footprint.events.every((entry) => entry.certain)).toBe(false);
    expect(footprint.empty).toBe(false);
  });

  it('reports nothing on a database that never had it', async () => {
    const footprint = await demoFootprint();
    expect(footprint.empty).toBe(true);
    expect(await removeDemoCatalogue()).toBe(0);
  });

  it('leaves a catalogue of your own alone', async () => {
    await create(db.items, {
      name: 'Course marking flag', sku: 'ST-FLAG', categoryId: null, unit: 'each', packSize: 1,
      bin: 'D1', qtyOnHand: 200, minQty: 50, barcode: null, notes: '', consumable: false,
      archived: false,
    });

    expect((await demoFootprint()).items).toBe(0);
  });

  it('says how much real packing hangs off each example race', async () => {
    await seedLegacyDemo();

    const footprint = await demoFootprint();
    const buffalo = footprint.events.find((entry) => entry.event.name === 'Buffalo Stampede');
    expect(buffalo).toBeDefined();
    expect(buffalo!.destinations).toBeGreaterThan(0);
    expect(buffalo!.packlists).toBeGreaterThan(0);
    // The seed ships part-packed lists, which is exactly the signal a crew
    // needs before deciding whether a race is theirs or the example.
    expect(buffalo!.packedLines).toBeGreaterThan(0);
  });
});

describe('removing the demo catalogue', () => {
  it('tombstones rather than clears, so the deletion can travel', async () => {
    await seedLegacyDemo();
    const before = await demoFootprint();

    expect(await removeDemoCatalogue()).toBe(before.catalogue);

    const items = await rowsOf('items');
    expect(items.length).toBeGreaterThan(40);
    expect(alive(items)).toHaveLength(0);
    expect(items.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('queues the deletions for sync, which is the whole point', async () => {
    await seedLegacyDemo();
    await markAllSynced();
    expect(await pendingCount(null)).toBe(0);

    await removeDemoCatalogue();

    expect(await pendingCount(null)).toBeGreaterThan(0);
    const queued = Object.values(await collectOutbox(null)).flatMap((rows) => rows ?? []);
    expect(queued.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('works on a database with random ids', async () => {
    await seedLegacyDemo({ randomIds: true });

    const removed = await removeDemoCatalogue();
    expect(removed).toBeGreaterThan(40);
    expect(alive(await rowsOf('items'))).toHaveLength(0);
    expect((await demoFootprint()).items).toBe(0);
  });

  it('leaves the races alone — those are a separate decision', async () => {
    await seedLegacyDemo();

    await removeDemoCatalogue();

    expect(alive(await rowsOf('events'))).toHaveLength(3);
  });

  it('is safe to run twice', async () => {
    await seedLegacyDemo();
    expect(await removeDemoCatalogue()).toBeGreaterThan(0);
    expect(await removeDemoCatalogue()).toBe(0);
  });
});

describe('removing one example race', () => {
  it('takes its destinations, packlists, lines and runs with it', async () => {
    await seedLegacyDemo();
    const { events } = await demoFootprint();
    const buffalo = events.find((entry) => entry.event.name === 'Buffalo Stampede')!;

    const removed = await removeDemoEvent(buffalo.event.id);
    expect(removed).toBeGreaterThan(buffalo.destinations + buffalo.packlists);

    expect(await db.events.get(buffalo.event.id).then((row) => row!.deletedAt)).not.toBeNull();
    expect(
      alive(await rowsOf('destinations')).filter(
        (row) => (row as { eventId?: string }).eventId === buffalo.event.id,
      ),
    ).toHaveLength(0);
    // The other two races are untouched.
    expect(alive(await rowsOf('events'))).toHaveLength(2);
  });

  it('keeps the stock ledger, which records what actually left the shed', async () => {
    await seedLegacyDemo();
    const before = alive(await rowsOf('movements')).length;
    const { events } = await demoFootprint();

    await removeDemoEvent(events[0].event.id);

    expect(alive(await rowsOf('movements'))).toHaveLength(before);
  });

  it('queues the removal for sync', async () => {
    await seedLegacyDemo();
    await markAllSynced();
    const { events } = await demoFootprint();

    await removeDemoEvent(events[0].event.id);

    expect(await pendingCount(null)).toBeGreaterThan(0);
  });
});

describe('reloading the catalogue after something removed it', () => {
  it('outranks the removal so sync does not delete it again', async () => {
    await seedStarterData();
    const items = alive(await rowsOf('items'));
    expect(items.length).toBeGreaterThan(0);

    // However the rows went — deleted by hand here, or a tombstone arriving
    // from another device — the reload has to be the newer fact.
    for (const row of items) await softDelete(db.items, row.id);
    const tombstones = new Map((await rowsOf('items')).map((row) => [row.id, row.rev]));

    await seedStarterData();

    const reloaded = await rowsOf('items');
    expect(alive(reloaded)).toHaveLength(reloaded.length);
    for (const row of reloaded) {
      // At or below the tombstone it would lose on the next pull, so the
      // catalogue would come back and then quietly disappear again.
      expect(row.rev).toBeGreaterThan(tombstones.get(row.id) ?? 0);
    }
  });

  it('queues the reload for sync', async () => {
    await seedStarterData();
    for (const row of alive(await rowsOf('items'))) await softDelete(db.items, row.id);
    await markAllSynced();
    expect(await pendingCount(null)).toBe(0);

    await seedStarterData();

    expect(await pendingCount(null)).toBeGreaterThan(0);
  });

  it('still starts at revision 1 on a device that has never seen it', async () => {
    await seedStarterData();
    expect((await rowsOf('items')).every((row) => row.rev === 1)).toBe(true);
  });
});

describe('erasing a device', () => {
  it('resets the sync cursor so the device can pull again', async () => {
    await seedStarterData();
    setCursor('4821');

    await wipeAll();

    // Left in place, the device would sit at the server's latest position and
    // pull nothing back — permanently empty rather than freshly restored.
    expect(getCursor()).toBeNull();
    expect(await db.items.count()).toBe(0);
  });

  it('does not tombstone anything, so the crew keeps their data', async () => {
    await seedStarterData();

    await wipeAll();

    // A hard clear on purpose: erasing a phone must not wipe the server.
    for (const name of SYNCED_TABLES) {
      expect(await db[name].count()).toBe(0);
    }
  });
});
