import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create } from '../db/repo';
import {
  isLowStock,
  isUncounted,
  itemsWithMovements,
  lowStockItems,
  pieces,
  recordMovements,
  setQuantity,
  shortfall,
} from './stock';
import type { Item } from '../db/types';

async function makeItem(overrides: Partial<Item> = {}) {
  return create(db.items, {
    name: 'Water cube 20L',
    sku: 'HYD-CUBE20',
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: 'A1',
    qtyOnHand: 10,
    minQty: 4,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
    ...overrides,
  });
}

describe('recording movements', () => {
  it('updates the balance and writes a ledger row', async () => {
    const item = await makeItem({ qtyOnHand: 10 });
    const [movement] = await recordMovements([
      { itemId: item.id, qty: -3, reason: 'issue', note: 'Aid 2' },
    ]);

    expect(movement.balanceAfter).toBe(7);
    expect(movement.reason).toBe('issue');
    expect((await db.items.get(item.id))!.qtyOnHand).toBe(7);
    expect(await db.movements.count()).toBe(1);
  });

  it('applies several movements in one call', async () => {
    const a = await makeItem({ sku: 'A', qtyOnHand: 5 });
    const b = await makeItem({ sku: 'B', qtyOnHand: 5 });

    await recordMovements([
      { itemId: a.id, qty: -2, reason: 'issue' },
      { itemId: b.id, qty: 4, reason: 'receipt' },
    ]);

    expect((await db.items.get(a.id))!.qtyOnHand).toBe(3);
    expect((await db.items.get(b.id))!.qtyOnHand).toBe(9);
  });

  it('never drives a balance below zero', async () => {
    const item = await makeItem({ qtyOnHand: 2 });
    const [movement] = await recordMovements([{ itemId: item.id, qty: -9, reason: 'issue' }]);

    expect(movement.balanceAfter).toBe(0);
    expect((await db.items.get(item.id))!.qtyOnHand).toBe(0);
  });

  it('ignores zero-quantity movements rather than cluttering the ledger', async () => {
    const item = await makeItem();
    const written = await recordMovements([{ itemId: item.id, qty: 0, reason: 'adjustment' }]);

    expect(written).toEqual([]);
    expect(await db.movements.count()).toBe(0);
  });

  it('skips movements for items that no longer exist', async () => {
    const written = await recordMovements([{ itemId: 'missing', qty: 5, reason: 'receipt' }]);
    expect(written).toEqual([]);
  });

  it('stamps the crew member and reference onto the ledger row', async () => {
    const item = await makeItem();
    const [movement] = await recordMovements([
      { itemId: item.id, qty: -1, reason: 'issue', by: 'Jess', refType: 'packlist', refId: 'pl-1' },
    ]);

    expect(movement.by).toBe('Jess');
    expect(movement.refType).toBe('packlist');
    expect(movement.refId).toBe('pl-1');
  });
});

describe('setQuantity', () => {
  it('writes only the difference to the ledger', async () => {
    const item = await makeItem({ qtyOnHand: 10 });
    const [movement] = await setQuantity(item.id, 7, 'stocktake');

    expect(movement.qty).toBe(-3);
    expect(movement.balanceAfter).toBe(7);
  });

  it('does nothing when the count already matches', async () => {
    const item = await makeItem({ qtyOnHand: 10 });
    expect(await setQuantity(item.id, 10, 'stocktake')).toEqual([]);
    expect(await db.movements.count()).toBe(0);
  });
});

describe('low stock', () => {
  const build = (overrides: Partial<Item>) => ({ archived: false, ...overrides }) as Item;

  it('flags an item at or below its reorder point', () => {
    expect(isLowStock(build({ qtyOnHand: 4, minQty: 4 }))).toBe(true);
    expect(isLowStock(build({ qtyOnHand: 3, minQty: 4 }))).toBe(true);
    expect(isLowStock(build({ qtyOnHand: 5, minQty: 4 }))).toBe(false);
  });

  it('ignores items with no reorder point set', () => {
    expect(isLowStock(build({ qtyOnHand: 0, minQty: 0 }))).toBe(false);
  });

  it('ignores archived items', () => {
    expect(isLowStock(build({ qtyOnHand: 0, minQty: 5, archived: true }))).toBe(false);
  });

  it('sorts the most urgent shortfall first', () => {
    const items = [
      build({ name: 'a', qtyOnHand: 3, minQty: 4 }),
      build({ name: 'b', qtyOnHand: 0, minQty: 10 }),
      build({ name: 'c', qtyOnHand: 20, minQty: 4 }),
    ];
    expect(lowStockItems(items).map((item) => item.name)).toEqual(['b', 'a']);
    expect(shortfall(items[1])).toBe(10);
  });
});

describe('pack sizes', () => {
  it('converts units into individual pieces', () => {
    const carton = { qtyOnHand: 3, packSize: 24 } as Item;
    expect(pieces(carton)).toBe(72);
    expect(pieces(carton, 1)).toBe(24);
  });
});

describe('uncounted stock', () => {
  const item = (over: Partial<Item> = {}): Item =>
    ({
      id: 'i1', createdAt: '', updatedAt: '', deletedAt: null, rev: 1, deviceId: '', syncedAt: null,
      name: 'Trestle Tables', sku: 'FRN-01', categoryId: null, unit: 'each', packSize: 1, bin: '',
      qtyOnHand: 0, minQty: 155, barcode: null, notes: '', consumable: false, archived: false,
      ...over,
    }) as Item;

  it('is not the same as being low', () => {
    const never = new Set<string>();
    // A catalogue imported from a packing list knows what the warehouse ought
    // to carry and nothing about what is on the shelf.
    expect(isUncounted(item(), never)).toBe(true);
    expect(isLowStock(item(), never)).toBe(false);
    // Without the ledger to consult, the old behaviour stands.
    expect(isLowStock(item())).toBe(true);
  });

  it('counts a shelf genuinely counted as empty', () => {
    // Setting a count writes a movement, so zero-on-the-ledger is a real zero.
    const counted = new Set(['i1']);
    expect(isUncounted(item(), counted)).toBe(false);
    expect(isLowStock(item(), counted)).toBe(true);
  });

  it('stops being uncounted the moment a quantity is recorded', () => {
    const never = new Set<string>();
    expect(isUncounted(item({ qtyOnHand: 200 }), never)).toBe(false);
    expect(isLowStock(item({ qtyOnHand: 200 }), never)).toBe(false);
    expect(isLowStock(item({ qtyOnHand: 100 }), new Set(['i1']))).toBe(true);
  });

  it('keeps uncounted items out of the low list', () => {
    const never = new Set<string>();
    const rows = [item(), item({ id: 'i2', qtyOnHand: 3, minQty: 10 })];
    expect(lowStockItems(rows, never).map((row) => row.id)).toEqual(['i2']);
    expect(lowStockItems(rows).map((row) => row.id)).toEqual(['i1', 'i2']);
  });

  it('reads the ledger to decide', async () => {
    const stocked = await create(db.items, {
      name: 'Water', sku: 'W', categoryId: null, unit: 'each', packSize: 1, bin: '',
      qtyOnHand: 0, minQty: 5, barcode: null, notes: '', consumable: false, archived: false,
    });
    expect(await itemsWithMovements()).toEqual(new Set());

    await recordMovements([{ itemId: stocked.id, qty: 4, reason: 'receipt' }]);

    expect(await itemsWithMovements()).toEqual(new Set([stocked.id]));
  });
});
