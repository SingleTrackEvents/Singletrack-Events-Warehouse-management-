import { describe, expect, it } from 'vitest';
import { db, getSettings } from './db';
import { alive } from './repo';
import { ensureSeeded, seedDemoData } from './seed';
import { progressFor } from '../domain/packlists';

describe('demo data', () => {
  it('gives a new device a worked example to look at', async () => {
    await seedDemoData();

    expect(await db.categories.count()).toBeGreaterThan(5);
    expect(await db.items.count()).toBeGreaterThan(40);
    expect(await db.templates.count()).toBeGreaterThan(2);
    expect(await db.events.count()).toBe(3);
    expect(await db.destinations.count()).toBeGreaterThan(5);
  });

  it('opens every balance on the ledger so history is complete', async () => {
    await seedDemoData();

    const items = alive(await db.items.toArray()).filter((item) => item.qtyOnHand > 0);
    const movements = alive(await db.movements.toArray());

    expect(movements).toHaveLength(items.length);
    expect(movements.every((movement) => movement.reason === 'receipt')).toBe(true);
    expect(movements.every((movement) => movement.balanceAfter === movement.qty)).toBe(true);
  });

  it('builds packlists at a mix of stages so each state is visible', async () => {
    await seedDemoData();

    const packlists = alive(await db.packlists.toArray());
    const statuses = new Set(packlists.map((packlist) => packlist.status));

    expect(packlists.length).toBeGreaterThan(4);
    expect(statuses.has('packed')).toBe(true);
    expect(statuses.has('picking')).toBe(true);
    expect(statuses.has('draft')).toBe(true);
  });

  it('gives every packlist a unique scannable code', async () => {
    await seedDemoData();

    const codes = alive(await db.packlists.toArray()).map((packlist) => packlist.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z0-9]{1,5}-[A-Z0-9]{4}$/.test(code))).toBe(true);
  });

  it('leaves the part-packed list genuinely part packed', async () => {
    await seedDemoData();

    const picking = alive(await db.packlists.toArray()).find((entry) => entry.status === 'picking')!;
    const lines = alive(await db.packlistLines.toArray()).filter(
      (line) => line.packlistId === picking.id,
    );
    const progress = progressFor(lines);

    expect(progress.percent).toBeGreaterThan(0);
    expect(progress.percent).toBeLessThan(100);
  });

  it('only seeds once, however many times the app boots', async () => {
    await ensureSeeded();
    const first = await db.items.count();

    await ensureSeeded();
    await ensureSeeded();

    expect(await db.items.count()).toBe(first);
    expect((await getSettings()).seeded).toBe(true);
  });

  it('does not seed over the top of a database that already has stock', async () => {
    await db.items.put({
      id: 'existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      rev: 1,
      deviceId: 'test',
      syncedAt: null,
      name: 'Their own item',
      sku: 'OWN',
      categoryId: null,
      unit: 'each',
      packSize: 1,
      bin: '',
      qtyOnHand: 1,
      minQty: 0,
      barcode: null,
      notes: '',
      consumable: false,
      archived: false,
    });

    await ensureSeeded();

    expect(await db.items.count()).toBe(1);
  });
});
