import { describe, expect, it } from 'vitest';
import { db, SYNCED_TABLES } from '../db/db';
import { alive, create } from '../db/repo';
import { seedDemoData, isDemoId } from '../db/seed';
import { collectOutbox, getCursor, pendingCount, setCursor } from '../sync/engine';
import { demoFootprint, removeDemoCatalogue, removeDemoEvent } from './demo';
import { wipeAll } from './backup';
import type { SyncMeta } from '../db/types';

const rowsOf = async (name: (typeof SYNCED_TABLES)[number]) =>
  (await db[name].toArray()) as SyncMeta[];

const bulk = (name: (typeof SYNCED_TABLES)[number]) =>
  db[name] as unknown as { bulkPut(rows: SyncMeta[]): Promise<unknown> };

/** What a database seeded before the ids became deterministic looks like. */
async function rewriteWithRandomIds() {
  for (const name of SYNCED_TABLES) {
    const rows = await rowsOf(name);
    if (!rows.length) continue;
    // References are rewritten too, so the graph still hangs together.
    const remap = new Map(rows.map((row) => [row.id, crypto.randomUUID()] as const));
    const swap = (value: unknown) =>
      typeof value === 'string' && remap.has(value) ? remap.get(value) : value;
    await db[name].clear();
    await bulk(name).bulkPut(
      rows.map((row) => {
        const copy: Record<string, unknown> = { ...row, id: remap.get(row.id) };
        for (const key of Object.keys(copy)) {
          if (key !== 'id') copy[key] = swap(copy[key]);
        }
        return copy as unknown as SyncMeta;
      }),
    );
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
    await seedDemoData();

    const footprint = await demoFootprint();
    expect(footprint.items).toBeGreaterThan(40);
    expect(footprint.templates).toBeGreaterThan(0);
    expect(footprint.categories).toBeGreaterThan(0);
    expect(footprint.events).toHaveLength(3);
    expect(footprint.events.every((entry) => entry.certain)).toBe(true);
    expect(footprint.empty).toBe(false);
  });

  it('still finds it when the ids are random, as on older databases', async () => {
    await seedDemoData();
    const before = await demoFootprint();
    await rewriteWithRandomIds();

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
    await seedDemoData();

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
    await seedDemoData();
    const before = await demoFootprint();

    expect(await removeDemoCatalogue()).toBe(before.catalogue);

    const items = await rowsOf('items');
    expect(items.length).toBeGreaterThan(40);
    expect(alive(items)).toHaveLength(0);
    expect(items.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('queues the deletions for sync, which is the whole point', async () => {
    await seedDemoData();
    await markAllSynced();
    expect(await pendingCount(null)).toBe(0);

    await removeDemoCatalogue();

    expect(await pendingCount(null)).toBeGreaterThan(0);
    const queued = Object.values(await collectOutbox(null)).flatMap((rows) => rows ?? []);
    expect(queued.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('works on a database with random ids', async () => {
    await seedDemoData();
    await rewriteWithRandomIds();

    const removed = await removeDemoCatalogue();
    expect(removed).toBeGreaterThan(40);
    expect(alive(await rowsOf('items'))).toHaveLength(0);
    expect((await demoFootprint()).items).toBe(0);
  });

  it('leaves the races alone — those are a separate decision', async () => {
    await seedDemoData();

    await removeDemoCatalogue();

    expect(alive(await rowsOf('events'))).toHaveLength(3);
  });

  it('is safe to run twice', async () => {
    await seedDemoData();
    expect(await removeDemoCatalogue()).toBeGreaterThan(0);
    expect(await removeDemoCatalogue()).toBe(0);
  });
});

describe('removing one example race', () => {
  it('takes its destinations, packlists, lines and runs with it', async () => {
    await seedDemoData();
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
    await seedDemoData();
    const before = alive(await rowsOf('movements')).length;
    const { events } = await demoFootprint();

    await removeDemoEvent(events[0].event.id);

    expect(alive(await rowsOf('movements'))).toHaveLength(before);
  });

  it('queues the removal for sync', async () => {
    await seedDemoData();
    await markAllSynced();
    const { events } = await demoFootprint();

    await removeDemoEvent(events[0].event.id);

    expect(await pendingCount(null)).toBeGreaterThan(0);
  });
});

describe('reloading the demo after removing it', () => {
  it('outranks the removal so sync does not delete it again', async () => {
    await seedDemoData();
    await removeDemoCatalogue();
    const tombstones = new Map(
      (await rowsOf('items')).filter((row) => isDemoId(row.id)).map((row) => [row.id, row.rev]),
    );
    expect(tombstones.size).toBeGreaterThan(0);

    await seedDemoData();

    const reloaded = (await rowsOf('items')).filter((row) => isDemoId(row.id));
    expect(alive(reloaded)).toHaveLength(reloaded.length);
    for (const row of reloaded) {
      // At or below the tombstone it would lose on the next pull, so the demo
      // would come back and then quietly disappear again.
      expect(row.rev).toBeGreaterThan(tombstones.get(row.id) ?? 0);
    }
  });

  it('still starts at revision 1 on a device that has never seen it', async () => {
    await seedDemoData();
    expect((await rowsOf('items')).every((row) => row.rev === 1)).toBe(true);
  });
});

describe('erasing a device', () => {
  it('resets the sync cursor so the device can pull again', async () => {
    await seedDemoData();
    setCursor('4821');

    await wipeAll();

    // Left in place, the device would sit at the server's latest position and
    // pull nothing back — permanently empty rather than freshly restored.
    expect(getCursor()).toBeNull();
    expect(await db.items.count()).toBe(0);
  });

  it('does not tombstone anything, so the crew keeps their data', async () => {
    await seedDemoData();

    await wipeAll();

    // A hard clear on purpose: erasing a phone must not wipe the server.
    for (const name of SYNCED_TABLES) {
      expect(await db[name].count()).toBe(0);
    }
  });
});
