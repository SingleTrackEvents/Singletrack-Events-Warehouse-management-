import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create } from '../db/repo';
import { seedDemoData } from '../db/seed';
import { countDuplicates, findDuplicateItems, findDuplicateTemplates, mergeDuplicates } from './duplicates';
import type { Item } from '../db/types';

async function makeItem(name: string, sku: string, overrides: Partial<Item> = {}) {
  return create(db.items, {
    name, sku, categoryId: null, unit: 'each', packSize: 1, bin: 'A1',
    qtyOnHand: 5, minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
    ...overrides,
  });
}

describe('finding duplicates', () => {
  it('matches on SKU regardless of spelling or case', async () => {
    await makeItem('Water cube 20L', 'HYD-CUBE20');
    await makeItem('water CUBE 20 litre', 'hyd-cube20');

    const groups = findDuplicateItems(alive(await db.items.toArray()));
    expect(groups).toHaveLength(1);
    expect(groups[0].drop).toHaveLength(1);
  });

  it('falls back to the name when no SKU is set', async () => {
    await makeItem('Snake bite kit', '');
    await makeItem('snake bite kit', '');

    expect(findDuplicateItems(alive(await db.items.toArray()))).toHaveLength(1);
  });

  it('leaves genuinely different items alone', async () => {
    await makeItem('Water cube 20L', 'HYD-CUBE20');
    await makeItem('Jerry can 20L', 'HYD-JERRY20');

    expect(findDuplicateItems(alive(await db.items.toArray()))).toHaveLength(0);
  });

  it('ignores archived items, which are already out of the way', async () => {
    await makeItem('Water cube 20L', 'HYD-CUBE20');
    await makeItem('Water cube 20L', 'HYD-CUBE20', { archived: true });

    expect(findDuplicateItems(alive(await db.items.toArray()))).toHaveLength(0);
  });

  it('keeps the earliest, so history stays attached to it', async () => {
    const first = await makeItem('Water cube', 'HYD-CUBE20');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await makeItem('Water cube', 'HYD-CUBE20');

    const [group] = findDuplicateItems(alive(await db.items.toArray()));
    expect(group.keep.id).toBe(first.id);
  });

  it('picks the same survivor on every device when timestamps tie', async () => {
    // Otherwise two phones merge differently and then sync the disagreement.
    const rows = [
      { id: 'bbb', createdAt: '2026-01-01T00:00:00.000Z', sku: 'X', name: 'X', archived: false },
      { id: 'aaa', createdAt: '2026-01-01T00:00:00.000Z', sku: 'X', name: 'X', archived: false },
    ] as unknown as Item[];

    expect(findDuplicateItems(rows)[0].keep.id).toBe('aaa');
    expect(findDuplicateItems([...rows].reverse())[0].keep.id).toBe('aaa');
  });
});

describe('merging', () => {
  /** Which copy survives is decided by the merge, not by creation order. */
  async function duplicatePair() {
    await makeItem('Water cube', 'HYD-CUBE20');
    await makeItem('Water cube', 'HYD-CUBE20');
    const [group] = findDuplicateItems(alive(await db.items.toArray()));
    return { keep: group.keep, drop: group.drop[0] };
  }

  it('moves packlist lines onto the surviving item', async () => {
    const { keep, drop } = await duplicatePair();
    const line = await create(db.packlistLines, {
      packlistId: 'pl-1', itemId: drop.id, qtyRequired: 4, qtyPacked: 0, qtyReturned: 0,
      mandatory: false, containerId: null, note: '', sort: 10,
    });

    const summary = await mergeDuplicates();

    expect(summary.itemsMerged).toBe(1);
    expect((await db.packlistLines.get(line.id))!.itemId).toBe(keep.id);
  });

  it('moves the stock ledger too, so history is not orphaned', async () => {
    const { keep, drop } = await duplicatePair();
    const movement = await create(db.movements, {
      itemId: drop.id, qty: 5, reason: 'receipt', balanceAfter: 5,
      refType: 'manual', refId: null, note: '', by: '',
    });

    await mergeDuplicates();

    expect((await db.movements.get(movement.id))!.itemId).toBe(keep.id);
  });

  it('retires the duplicate without hard-deleting it', async () => {
    const { drop } = await duplicatePair();

    await mergeDuplicates();

    const stored = (await db.items.get(drop.id))!;
    expect(stored.archived).toBe(true);
    expect(stored.deletedAt).not.toBeNull();
  });

  it('never adds the quantities together', async () => {
    // Two records for one shelf is a naming problem, not twice the stock.
    const { keep } = await duplicatePair();

    await mergeDuplicates();

    expect((await db.items.get(keep.id))!.qtyOnHand).toBe(5);
  });

  it('removes a duplicated template along with its lines', async () => {
    const keep = await create(db.templates, {
      name: 'Standard aid station', appliesTo: 'aid_station', description: '',
    });
    const drop = await create(db.templates, {
      name: 'standard aid station', appliesTo: 'aid_station', description: '',
    });
    const line = await create(db.templateLines, {
      templateId: drop.id, itemId: 'item-1', qty: 1, mandatory: false,
      perRunner: false, note: '', sort: 10,
    });

    const summary = await mergeDuplicates();

    expect(summary.templatesMerged).toBe(1);
    expect((await db.templates.get(drop.id))!.deletedAt).not.toBeNull();
    expect((await db.templateLines.get(line.id))!.deletedAt).not.toBeNull();
    expect((await db.templates.get(keep.id))!.deletedAt).toBeNull();
  });

  it('is safe to run twice', async () => {
    await makeItem('Water cube', 'HYD-CUBE20');
    await makeItem('Water cube', 'HYD-CUBE20');

    await mergeDuplicates();
    const second = await mergeDuplicates();

    expect(second.itemsMerged).toBe(0);
  });

  it('does nothing when there is nothing to merge', async () => {
    await makeItem('Water cube', 'HYD-CUBE20');
    expect(await mergeDuplicates()).toEqual({
      itemsMerged: 0, templatesMerged: 0, referencesMoved: 0,
    });
  });
});

describe('the two-phone case that caused this', () => {
  it('seeding twice no longer doubles anything', async () => {
    // Each phone seeds its own copy; sync merges them. With ids derived from
    // the content the two copies are the same rows, so they collapse.
    await seedDemoData();
    const afterFirst = await db.items.count();
    await seedDemoData();

    expect(await db.items.count()).toBe(afterFirst);
    expect((await countDuplicates()).items).toBe(0);
  });

  it('reports the damage on a database that was already doubled', async () => {
    await makeItem('Water cube', 'HYD-CUBE20');
    await makeItem('Water cube', 'HYD-CUBE20');
    await makeItem('Gels', 'NUT-GEL24');
    await makeItem('Gels', 'NUT-GEL24');

    expect((await countDuplicates()).items).toBe(2);
  });

  it('templates seeded twice collapse as well', async () => {
    await seedDemoData();
    await seedDemoData();
    expect(findDuplicateTemplates(alive(await db.templates.toArray()))).toHaveLength(0);
  });
});
