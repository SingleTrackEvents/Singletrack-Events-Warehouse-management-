import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, liveWhere } from '../db/repo';
import { recordMovements, setQuantity } from './stock';
import {
  cancelStocktake,
  compareShelves,
  completeStocktake,
  countProblem,
  deltaFor,
  isSurprisingCount,
  overlappingStocktakes,
  recordCount,
  setCountNote,
  setShelf,
  startStocktake,
  summarise,
  tidyShelf,
  uncountedSummary,
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

// Counts and corrections are ordered by timestamp, and two steps in one
// millisecond would be a tie no real crew could produce.
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

const lineFor = async (stocktakeId: string, itemId: string) =>
  (await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktakeId)).find((line) => line.itemId === itemId)!;

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

describe('two counts over the same item', () => {
  it('lands on the later count when the earlier stocktake is finished first', async () => {
    const weights = await makeItem('weights', 100);
    const first = await startStocktake('Monday');
    const second = await startStocktake('Tuesday');

    await recordCount((await lineFor(first.id, weights.id)).id, 96);
    await tick();
    await recordCount((await lineFor(second.id, weights.id)).id, 98);
    await tick();
    await completeStocktake(first);
    expect((await db.items.get(weights.id))!.qtyOnHand).toBe(96);
    await tick();
    await completeStocktake(second);

    expect((await db.items.get(weights.id))!.qtyOnHand).toBe(98);
  });

  it('lands on the later count when the later stocktake is finished first', async () => {
    const weights = await makeItem('weights', 100);
    const first = await startStocktake('Monday');
    const second = await startStocktake('Tuesday');

    await recordCount((await lineFor(first.id, weights.id)).id, 96);
    await tick();
    await recordCount((await lineFor(second.id, weights.id)).id, 98);
    await tick();
    await completeStocktake(second);
    await tick();
    // Monday's line is older than the count already applied, so it gives way.
    expect(await completeStocktake(first)).toBe(0);

    expect((await db.items.get(weights.id))!.qtyOnHand).toBe(98);
  });

  it('counts against the corrected figure when the first stocktake closed before counting', async () => {
    const weights = await makeItem('weights', 100);
    const first = await startStocktake('Monday');
    const second = await startStocktake('Tuesday');

    await recordCount((await lineFor(first.id, weights.id)).id, 96);
    await tick();
    await completeStocktake(first);
    await tick();
    await recordCount((await lineFor(second.id, weights.id)).id, 98);
    await tick();
    await completeStocktake(second);

    expect((await db.items.get(weights.id))!.qtyOnHand).toBe(98);
  });

  it('gives way to a spot count taken after the line was counted', async () => {
    const weights = await makeItem('weights', 100);
    const stocktake = await startStocktake('Count');
    await recordCount((await lineFor(stocktake.id, weights.id)).id, 96);
    await tick();
    await setQuantity(weights.id, 90, 'stocktake', { note: 'Spot count' });
    await tick();
    await completeStocktake(stocktake);

    expect((await db.items.get(weights.id))!.qtyOnHand).toBe(90);
  });

  it('still lets ordinary movements after the count stand', async () => {
    const cubes = await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    await recordCount((await lineFor(stocktake.id, cubes.id)).id, 8);
    await tick();
    // The truck leaves with four after the rack was counted.
    await recordMovements([{ itemId: cubes.id, qty: -4, reason: 'issue' }]);
    await tick();
    await completeStocktake(stocktake);

    expect((await db.items.get(cubes.id))!.qtyOnHand).toBe(4);
  });

  it('names an open stocktake whose scope overlaps a new one', async () => {
    const hydration = await create(db.categories, { name: 'Hydration', sort: 10, icon: '💧' });
    const food = await create(db.categories, { name: 'Food', sort: 20, icon: '🍌' });
    await makeItem('cubes', 10, hydration.id);
    const water = await startStocktake('Water', { categoryId: hydration.id });

    expect((await overlappingStocktakes(hydration.id)).map((entry) => entry.id)).toEqual([water.id]);
    expect(await overlappingStocktakes(food.id)).toHaveLength(0);
    expect(await overlappingStocktakes(null)).toHaveLength(1);

    await cancelStocktake(water.id);
    expect(await overlappingStocktakes(null)).toHaveLength(0);
  });
});

describe('a closed stocktake', () => {
  it('refuses new counts, notes and shelves once completed or cancelled', async () => {
    await makeItem('cubes', 10);
    const done = await startStocktake('Done');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', done.id);
    await recordCount(line.id, 8);
    await completeStocktake(done);

    await expect(recordCount(line.id, 3)).rejects.toThrow(/closed/);
    await expect(recordCount(line.id, null)).rejects.toThrow(/closed/);
    await expect(setCountNote(line.id, 'oops')).rejects.toThrow(/closed/);
    await expect(setShelf(line.id, 'b2')).rejects.toThrow(/closed/);
    expect((await db.stocktakeCounts.get(line.id))!.counted).toBe(8);

    const dropped = await startStocktake('Dropped');
    const [other] = await liveWhere(db.stocktakeCounts, 'stocktakeId', dropped.id);
    await cancelStocktake(dropped.id);
    await expect(recordCount(other.id, 5)).rejects.toThrow(/closed/);
  });
});

describe('typed counts', () => {
  it('refuses a negative count rather than reading it as none', async () => {
    await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    await expect(recordCount(line.id, -3)).rejects.toThrow(/less than nothing/);
    expect((await db.stocktakeCounts.get(line.id))!.counted).toBeNull();
    expect(countProblem(0)).toBeNull();
    expect(countProblem(Number.NaN)).not.toBeNull();
    expect(countProblem(5_000_000)).not.toBeNull();
  });

  it('asks about an absurd count but takes a big real one', () => {
    expect(isSurprisingCount(1150)).toBe(false);
    expect(isSurprisingCount(250_000)).toBe(true);
  });
});

describe('notes and shelves from the count', () => {
  it('keeps a note on the line and files the item on a tidied shelf', async () => {
    const cubes = await makeItem('cubes', 10);
    const stocktake = await startStocktake('Count');
    const [line] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);

    await setCountNote(line.id, '  two boxes water damaged ');
    expect(await setShelf(line.id, ' b  12 ')).toBe('B 12');

    expect((await db.stocktakeCounts.get(line.id))!.note).toBe('two boxes water damaged');
    expect((await db.items.get(cubes.id))!.bin).toBe('B 12');
    expect(tidyShelf('a3')).toBe('A3');
  });

  it('walks the shelves in number order with unshelved items last', () => {
    const shelves = ['A10', '', 'a2', 'B1', 'A1'];
    expect([...shelves].sort(compareShelves)).toEqual(['A1', 'a2', 'A10', 'B1', '']);
  });
});

describe('the counting still to do', () => {
  it('points at the open stocktake while lines are left, then at items never counted', async () => {
    const cubes = await makeItem('cubes', 0);
    await makeItem('gels', 0);
    expect((await uncountedSummary())?.title).toBe('2 items in the warehouse have never been counted');

    const stocktake = await startStocktake('Spring count');
    const summary = await uncountedSummary();
    expect(summary).toMatchObject({ href: `/stocktake/${stocktake.id}`, remaining: 2, stocktakeId: stocktake.id });
    expect(summary?.detail).toBe('2 items of 2 still to count');

    // A shelf confirmed empty is counted, even though it writes no movement.
    await recordCount((await lineFor(stocktake.id, cubes.id)).id, 0);
    await completeStocktake(stocktake);
    expect((await uncountedSummary())?.title).toBe('One item in the warehouse has never been counted');
  });

  it('has nothing to say once everything has been counted', async () => {
    const cubes = await makeItem('cubes', 5);
    await recordMovements([{ itemId: cubes.id, qty: 1, reason: 'receipt' }]);
    expect(await uncountedSummary()).toBeNull();
  });
});
