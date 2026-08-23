import { describe, expect, it } from 'vitest';
import { db, SYNCED_TABLES } from '../db/db';
import { alive, create } from '../db/repo';
import { seedDemoData, isDemoId } from '../db/seed';
import { collectOutbox, pendingCount } from '../sync/engine';
import type { SyncMeta } from '../db/types';
import { demoFootprint, removeDemoData } from './demo';
import { wipeAll } from './backup';
import { getCursor, setCursor } from '../sync/engine';

describe('removing the demo data', () => {
  it('reports what the seed left behind', async () => {
    await seedDemoData();

    const footprint = await demoFootprint();
    expect(footprint.events).toBe(3);
    expect(footprint.items).toBeGreaterThan(40);
    expect(footprint.templates).toBeGreaterThan(0);
    expect(footprint.records).toBeGreaterThan(footprint.items);
    expect(footprint.yourRecordsAffected).toBe(0);
  });

  it('tombstones every demo record rather than clearing it', async () => {
    await seedDemoData();
    const before = await demoFootprint();

    const removed = await removeDemoData();
    expect(removed).toBe(before.records);

    for (const name of SYNCED_TABLES) {
      const rows = await db[name].toArray();
      const demo = rows.filter((row) => isDemoId(row.id));
      // Still present as rows — a hard delete would have nothing to sync.
      expect(demo.every((row) => row.deletedAt !== null)).toBe(true);
      expect(alive(demo)).toHaveLength(0);
    }
  });

  it('queues the deletions for sync, which is the whole point', async () => {
    await seedDemoData();
    // Pretend everything has already been pushed once.
    const now = new Date().toISOString();
    for (const name of SYNCED_TABLES) {
      const rows = (await db[name].toArray()) as SyncMeta[];
      await (db[name] as unknown as { bulkPut(rows: SyncMeta[]): Promise<unknown> }).bulkPut(
        rows.map((row) => ({ ...row, syncedAt: now })),
      );
    }
    expect(await pendingCount(null)).toBe(0);

    await removeDemoData();

    expect(await pendingCount(null)).toBeGreaterThan(0);
    const queued = Object.values(await collectOutbox(null)).flatMap((rows) => rows ?? []);
    expect(queued.every((row) => row.deletedAt !== null)).toBe(true);
    expect(queued.every((row) => isDemoId(row.id))).toBe(true);
  });

  it('raises the revision so a device that re-seeds drops its copy', async () => {
    await seedDemoData();
    const [item] = alive(await db.items.toArray()).filter((row) => isDemoId(row.id));
    const seeded = item.rev;

    await removeDemoData();

    const tombstone = (await db.items.get(item.id))!;
    // A newly seeded copy elsewhere carries the seed revision, so newest-wins
    // resolves in favour of this tombstone rather than resurrecting the demo.
    expect(tombstone.rev).toBeGreaterThan(seeded);
  });

  it('leaves your own records alone', async () => {
    await seedDemoData();
    const mine = await create(db.events, {
      name: 'Wonderland Run', location: 'Halls Gap, VIC', startDate: '2027-02-06',
      endDate: '2027-02-06', status: 'planning', notes: '',
    });

    await removeDemoData();

    expect((await db.events.get(mine.id))!.deletedAt).toBeNull();
    expect(alive(await db.events.toArray())).toHaveLength(1);
  });

  it('counts your records that point at demo ones before removing them', async () => {
    await seedDemoData();
    const [demoItem] = alive(await db.items.toArray()).filter((row) => isDemoId(row.id));
    await create(db.packlistLines, {
      packlistId: 'my-packlist', itemId: demoItem.id, qtyRequired: 4, qtyPacked: 0,
      qtyReturned: 0, mandatory: false, containerId: null, note: '', sort: 10,
    });

    expect((await demoFootprint()).yourRecordsAffected).toBe(1);
  });

  it('reports nothing on a database with no demo data', async () => {
    const footprint = await demoFootprint();
    expect(footprint.records).toBe(0);
    expect(await removeDemoData()).toBe(0);
  });

  it('is safe to run twice', async () => {
    await seedDemoData();
    const first = await removeDemoData();
    expect(first).toBeGreaterThan(0);
    // Nothing is left alive to remove, so the second pass is a no-op rather
    // than a second round of revision bumps flooding the outbox.
    expect(await removeDemoData()).toBe(0);
  });
});

describe('erasing a device', () => {
  it('resets the sync cursor so the device can pull again', async () => {
    await seedDemoData();
    setCursor('4821');
    expect(getCursor()).toBe('4821');

    await wipeAll();

    // Left in place, the device would sit at the server's latest position and
    // pull nothing back — permanently empty rather than freshly restored.
    expect(getCursor()).toBeNull();
    expect(await db.items.count()).toBe(0);
  });

  it('does not tombstone anything, so the crew keeps their data', async () => {
    await seedDemoData();

    await wipeAll();

    // A hard clear on purpose: erasing a phone must not delete the server's copy.
    for (const name of SYNCED_TABLES) {
      expect(await db[name].count()).toBe(0);
    }
  });
});

describe('reloading the demo after removing it', () => {
  it('outranks the removal so sync does not delete it again', async () => {
    await seedDemoData();
    await removeDemoData();
    const tombstoneRevs = new Map(
      ((await db.items.toArray()) as SyncMeta[])
        .filter((row) => isDemoId(row.id))
        .map((row) => [row.id, row.rev] as const),
    );
    expect(tombstoneRevs.size).toBeGreaterThan(0);

    await seedDemoData();

    const reloaded = ((await db.items.toArray()) as SyncMeta[]).filter((row) => isDemoId(row.id));
    expect(alive(reloaded).length).toBe(reloaded.length);
    for (const row of reloaded) {
      // A revision at or below the tombstone would lose to it on the next pull,
      // so the demo would come back and then quietly disappear.
      expect(row.rev).toBeGreaterThan(tombstoneRevs.get(row.id) ?? 0);
    }
  });

  it('queues the reload for sync', async () => {
    await seedDemoData();
    await removeDemoData();
    const now = new Date().toISOString();
    for (const name of SYNCED_TABLES) {
      const rows = (await db[name].toArray()) as SyncMeta[];
      await (db[name] as unknown as { bulkPut(rows: SyncMeta[]): Promise<unknown> }).bulkPut(
        rows.map((row) => ({ ...row, syncedAt: now })),
      );
    }
    expect(await pendingCount(null)).toBe(0);

    await seedDemoData();

    expect(await pendingCount(null)).toBeGreaterThan(0);
  });

  it('still starts at revision 1 on a device that has never seen the demo', async () => {
    await seedDemoData();
    const items = ((await db.items.toArray()) as SyncMeta[]).filter((row) => isDemoId(row.id));
    expect(items.every((row) => row.rev === 1)).toBe(true);
  });
});
