import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, liveWhere } from '../db/repo';
import { recordMovements } from './stock';
import {
  cancelStocktake,
  completeStocktake,
  deltaFor,
  recordCount,
  startStocktake,
  summarise,
  variances,
} from './stocktake';
import type { Item, StocktakeCount } from '../db/types';

async function makeItem(name: string, qtyOnHand: number, categoryId: string | null = null) {
  return create(db.items, {
    name,
    sku: name.toUpperCase(),
    categoryId,
    unit: 'each',
    packSize: 1,
    bin: 'A1',
    qtyOnHand,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
  });
}

const count = (overrides: Partial<StocktakeCount>): StocktakeCount =>
  ({ expected: 0, counted: null, deletedAt: null, ...overrides }) as StocktakeCount;

describe('starting a stocktake', () => {
  it('opens a blank count line for every active item', async () => {
    await makeItem('cubes', 10);
    await makeItem('gels', 4);

    const stocktake = await startStocktake('Full count');
    const lines = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.counted === null)).toBe(true);
    expect(lines.map((line) => line.expected).sort((a, b) => a - b)).toEqual([4, 10]);
  });

  it('leaves archived items out of scope', async () => {
    await makeItem('cubes', 10);
    const retired = await makeItem('old radio', 2);
    await db.items.put({ ...retired, archived: true });

    const stocktake = await startStocktake('Full count');
    expect(await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id)).toHaveLength(1);
  });

  it('can be scoped to one category', async () => {
    const category = await create(db.categories, { name: 'Hydration', sort: 10, icon: '💧' });
    await makeItem('cubes', 10, category.id);
    await makeItem('gels', 4);

    const stocktake = await startStocktake('Hydration only', { categoryId: category.id });
    const lines = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    expect(lines).toHaveLength(1);
    expect(stocktake.categoryId).toBe(category.id);
  });
});

describe('recording counts', () => {
  it('re-reads what the system expects at the moment of counting', async () => {
    const item = await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    // A truck leaves after the session opened but before this rack is counted.
    await recordMovements([{ itemId: item.id, qty: -4, reason: 'issue' }]);
    await recordCount(line.id, 6, { by: 'Tom' });

    const updated = (await db.stocktakeCounts.get(line.id))!;
    expect(updated.expected).toBe(6);
    expect(deltaFor(updated)).toBe(0);
    expect(updated.countedBy).toBe('Tom');
  });

  it('clears a count back to uncounted', async () => {
    await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    await recordCount(line.id, 8, { by: 'Tom' });
    await recordCount(line.id, null);

    const updated = (await db.stocktakeCounts.get(line.id))!;
    expect(updated.counted).toBeNull();
    expect(updated.countedAt).toBeNull();
  });
});

describe('variance', () => {
  it('reports the difference and orders by size', () => {
    const items = new Map<string, Item>([
      ['a', { id: 'a', name: 'cubes' } as Item],
      ['b', { id: 'b', name: 'gels' } as Item],
    ]);
    const rows = variances(
      [
        count({ id: '1', itemId: 'a', expected: 10, counted: 8 }),
        count({ id: '2', itemId: 'b', expected: 4, counted: 12 }),
        count({ id: '3', itemId: 'a', expected: 5, counted: 5 }),
      ],
      items,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].delta).toBe(8);
    expect(rows[1].delta).toBe(-2);
    expect(rows[1].ratio).toBeCloseTo(0.2);
  });

  it('has no ratio when nothing was expected', () => {
    const rows = variances([count({ id: '1', itemId: 'a', expected: 0, counted: 3 })], new Map());
    expect(rows[0].ratio).toBeNull();
  });
});

describe('summary', () => {
  it('tracks progress and the net swing', () => {
    const summary = summarise([
      count({ id: '1', expected: 10, counted: 8 }),
      count({ id: '2', expected: 4, counted: 6 }),
      count({ id: '3', expected: 2, counted: null }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.counted).toBe(2);
    expect(summary.remaining).toBe(1);
    expect(summary.percent).toBe(67);
    expect(summary.discrepancies).toBe(2);
    expect(summary.netDelta).toBe(0);
  });
});

describe('completing a stocktake', () => {
  it('corrects stock and writes the ledger entries', async () => {
    const cubes = await makeItem('cubes', 10);
    const gels = await makeItem('gels', 4);
    const stocktake = await startStocktake('Count', { startedBy: 'Tom' });
    const lines = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    for (const entry of lines) {
      await recordCount(entry.id, entry.itemId === cubes.id ? 8 : 4, { by: 'Tom' });
    }
    const applied = await completeStocktake(stocktake, 'Tom');

    expect(applied).toBe(1);
    expect((await db.items.get(cubes.id))!.qtyOnHand).toBe(8);
    expect((await db.items.get(gels.id))!.qtyOnHand).toBe(4);

    const movements = await db.movements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('stocktake');
    expect(movements[0].qty).toBe(-2);
    expect((await db.stocktakes.get(stocktake.id))!.status).toBe('completed');
  });

  it('leaves uncounted items untouched rather than zeroing them', async () => {
    const cubes = await makeItem('cubes', 10);
    const gels = await makeItem('gels', 4);
    const stocktake = await startStocktake('Partial count');
    const lines = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);
    const cubesLine = lines.find((line) => line.itemId === cubes.id)!;

    await recordCount(cubesLine.id, 7);
    await completeStocktake(stocktake);

    expect((await db.items.get(cubes.id))!.qtyOnHand).toBe(7);
    expect((await db.items.get(gels.id))!.qtyOnHand).toBe(4);
  });

  it('cannot be applied twice', async () => {
    await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);
    await recordCount(line.id, 8);

    await completeStocktake(stocktake);
    const closed = (await db.stocktakes.get(stocktake.id))!;
    expect(await completeStocktake(closed)).toBe(0);
    expect(await db.movements.count()).toBe(1);
  });

  it('writes nothing when a stocktake is cancelled', async () => {
    await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);
    await recordCount(line.id, 3);

    await cancelStocktake(stocktake.id);

    expect((await db.items.get(line.itemId))!.qtyOnHand).toBe(10);
    expect(await db.movements.count()).toBe(0);
  });
});
