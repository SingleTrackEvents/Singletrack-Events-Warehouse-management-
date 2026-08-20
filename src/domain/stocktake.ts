import { db } from '../db/db';
import { create, createMany, liveWhere, update } from '../db/repo';
import type { Item, Stocktake, StocktakeCount } from '../db/types';
import { recordMovements, round2 } from './stock';

/**
 * Stocktaking.
 *
 * A session opens with one blank count line per item in scope. Crew walk the
 * racks entering what they actually see; the expected figure is captured at the
 * moment each line is counted (not when the session opened) so a count taken
 * after a truck leaves still compares against the right number. Completing the
 * session writes the differences to the ledger as `stocktake` corrections.
 */

export interface Variance {
  count: StocktakeCount;
  item: Item | undefined;
  /** counted − expected. Positive means more on the shelf than the system knew. */
  delta: number;
  /** Absolute delta as a share of expected, 0–1. Null when expected is 0. */
  ratio: number | null;
}

/** Open a stocktake over every active item, or one category. */
export async function startStocktake(
  name: string,
  options: { categoryId?: string | null; startedBy?: string; items?: Item[] } = {},
): Promise<Stocktake> {
  const categoryId = options.categoryId ?? null;
  const allItems =
    options.items ?? (await db.items.toArray()).filter((item) => !item.deletedAt && !item.archived);
  const scoped = categoryId ? allItems.filter((item) => item.categoryId === categoryId) : allItems;

  const stocktake = await create(db.stocktakes, {
    name: name.trim() || `Stocktake ${new Date().toLocaleDateString()}`,
    status: 'open',
    categoryId,
    startedBy: options.startedBy ?? '',
    completedAt: null,
    notes: '',
  });

  await createMany(
    db.stocktakeCounts,
    scoped.map((item) => ({
      stocktakeId: stocktake.id,
      itemId: item.id,
      expected: item.qtyOnHand,
      counted: null,
      countedAt: null,
      countedBy: '',
      note: '',
    })),
  );

  return stocktake;
}

/** Enter a physical count, re-snapshotting what the system expected right now. */
export async function recordCount(
  countId: string,
  counted: number | null,
  options: { by?: string; note?: string } = {},
): Promise<void> {
  const row = await db.stocktakeCounts.get(countId);
  if (!row) return;
  const item = await db.items.get(row.itemId);
  await update(db.stocktakeCounts, countId, {
    counted: counted === null ? null : round2(counted),
    expected: item ? item.qtyOnHand : row.expected,
    countedAt: counted === null ? null : new Date().toISOString(),
    countedBy: counted === null ? '' : (options.by ?? row.countedBy),
    note: options.note ?? row.note,
  });
}

/** counted − expected for a single line. Uncounted lines have no variance. */
export function deltaFor(count: StocktakeCount): number {
  if (count.counted === null) return 0;
  return round2(count.counted - count.expected);
}

/** Lines that differ from expectation, biggest discrepancy first. */
export function variances(counts: StocktakeCount[], items: Map<string, Item>): Variance[] {
  return counts
    .filter((count) => count.counted !== null && deltaFor(count) !== 0)
    .map((count) => {
      const delta = deltaFor(count);
      return {
        count,
        item: items.get(count.itemId),
        delta,
        ratio: count.expected > 0 ? Math.abs(delta) / count.expected : null,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export interface StocktakeSummary {
  total: number;
  counted: number;
  remaining: number;
  percent: number;
  discrepancies: number;
  /** Net units gained (positive) or lost (negative) across the whole count. */
  netDelta: number;
}

export function summarise(counts: StocktakeCount[]): StocktakeSummary {
  const live = counts.filter((count) => !count.deletedAt);
  const counted = live.filter((count) => count.counted !== null);
  const discrepancies = counted.filter((count) => deltaFor(count) !== 0);
  return {
    total: live.length,
    counted: counted.length,
    remaining: live.length - counted.length,
    percent: live.length ? Math.round((counted.length / live.length) * 100) : 0,
    discrepancies: discrepancies.length,
    netDelta: round2(discrepancies.reduce((sum, count) => sum + deltaFor(count), 0)),
  };
}

/**
 * Close a stocktake, writing every discrepancy to the ledger. Uncounted lines
 * are left alone — a partial count never zeroes out stock nobody looked at.
 */
export async function completeStocktake(stocktake: Stocktake, by = ''): Promise<number> {
  if (stocktake.status !== 'open') return 0;
  const counts = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);
  const corrections = counts
    .filter((count) => count.counted !== null && deltaFor(count) !== 0)
    .map((count) => ({
      itemId: count.itemId,
      qty: deltaFor(count),
      reason: 'stocktake' as const,
      refType: 'stocktake' as const,
      refId: stocktake.id,
      note: stocktake.name,
      by: by || count.countedBy,
    }));

  await recordMovements(corrections);
  await update(db.stocktakes, stocktake.id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
  return corrections.length;
}

export async function cancelStocktake(stocktakeId: string): Promise<void> {
  await update(db.stocktakes, stocktakeId, { status: 'cancelled' });
}
