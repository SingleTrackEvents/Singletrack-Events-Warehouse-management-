import { db } from '../db/db';
import { create, createMany, liveWhere, update } from '../db/repo';
import type { Item, Movement, Stocktake, StocktakeCount } from '../db/types';
import { plural } from './format';
import { countedItemIds, isUncounted, recordMovements, round2 } from './stock';

/**
 * Stocktaking.
 *
 * A session opens with one blank count line per item in scope. Crew walk the
 * racks entering what they actually see; the expected figure is captured at the
 * moment each line is counted (not when the session opened) so a count taken
 * after a truck leaves still compares against the right number. Completing the
 * session writes the differences to the ledger as `stocktake` corrections.
 *
 * The count is blind: the screen holds back the system's figure until a number
 * has been typed, so the crew count the shelf rather than confirm the app.
 */

/** Above this a typed count is asked about before it is recorded. */
export const COUNT_WARN_ABOVE = 100_000;
/** Above this a count is refused outright: nobody has a million of anything. */
export const COUNT_MAX = 1_000_000;

/** Why a typed count cannot be recorded, or null when it can. */
export function countProblem(value: number): string | null {
  if (!Number.isFinite(value)) return 'That is not a number.';
  if (value < 0) return 'A count cannot be less than nothing. Enter 0 for an empty shelf.';
  if (value > COUNT_MAX) {
    return `That is more than ${COUNT_MAX.toLocaleString('en-AU')}. Check the number and try again.`;
  }
  return null;
}

/** True for a count big enough that it is worth a second look before saving. */
export function isSurprisingCount(value: number): boolean {
  return value > COUNT_WARN_ABOVE;
}

/**
 * A shelf as it should be stored: trimmed, one space between words, upper
 * case. "a3 " and "A3" are the same shelf and should sort together.
 */
export function tidyShelf(shelf: string): string {
  return shelf.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Shelf order for walking the racks: A1, A2, A10 rather than A1, A10, A2, and
 * items with no shelf at the end, where they get found last anyway.
 */
export function compareShelves(a: string | null | undefined, b: string | null | undefined): number {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

export interface Variance {
  count: StocktakeCount;
  item: Item | undefined;
  /** counted − expected. Positive means more on the shelf than the system knew. */
  delta: number;
  /** Absolute delta as a share of expected, 0–1. Null when expected is 0. */
  ratio: number | null;
}

/** True when two stocktake scopes could hold the same item. Null means everything. */
function scopesOverlap(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b;
}

/**
 * Open stocktakes that would count some of the same items as a new one over
 * this scope. Two counts of one shelf running at once is how a correction
 * gets applied twice, so the start sheet says so before opening another.
 */
export async function overlappingStocktakes(categoryId: string | null): Promise<Stocktake[]> {
  return (await db.stocktakes.toArray()).filter(
    (stocktake) =>
      !stocktake.deletedAt &&
      stocktake.status === 'open' &&
      scopesOverlap(stocktake.categoryId, categoryId),
  );
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

/** A count line, refusing one whose stocktake is no longer open. */
async function openLine(countId: string): Promise<StocktakeCount | undefined> {
  const row = await db.stocktakeCounts.get(countId);
  if (!row || row.deletedAt) return undefined;
  const stocktake = await db.stocktakes.get(row.stocktakeId);
  // A finished count is the record of what was on the shelf that day, and a
  // cancelled one was abandoned. Changing either afterwards rewrites history.
  if (!stocktake || stocktake.status !== 'open') {
    throw new Error('This stocktake is closed. Start a new one to count again.');
  }
  return row;
}

/** Enter a physical count, re-snapshotting what the system expected right now. */
export async function recordCount(
  countId: string,
  counted: number | null,
  options: { by?: string; note?: string } = {},
): Promise<void> {
  if (counted !== null) {
    const problem = countProblem(counted);
    if (problem) throw new Error(problem);
  }
  const row = await openLine(countId);
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

/** A short note on one count line: "two boxes water damaged", "rest in the van". */
export async function setCountNote(countId: string, note: string): Promise<void> {
  const row = await openLine(countId);
  if (!row) return;
  await update(db.stocktakeCounts, countId, { note: note.trim() });
}

/**
 * Record which shelf the item lives on, from its count line.
 *
 * A stocktake is the one time somebody stands at every shelf, so it is the
 * natural moment to fill in the bins the catalogue never had. It changes the
 * item, not the count, and hands back the shelf as stored.
 */
export async function setShelf(countId: string, shelf: string): Promise<string | undefined> {
  const row = await openLine(countId);
  if (!row) return undefined;
  const bin = tidyShelf(shelf);
  await update(db.items, row.itemId, { bin });
  return bin;
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
 * When the count behind a stocktake correction was taken.
 *
 * A correction from another stocktake was counted when its line was, which
 * can be well before that stocktake was finished. A spot count off the item
 * page is counted and applied in the same moment.
 */
function countTimeFor(movement: Movement, otherLines: Map<string, StocktakeCount[]>): string {
  if (movement.refType === 'stocktake' && movement.refId) {
    const line = otherLines.get(movement.refId)?.find((entry) => entry.itemId === movement.itemId);
    if (line?.countedAt) return line.countedAt;
  }
  return movement.createdAt;
}

/**
 * The correction a counted line should write now, or null when a newer count
 * has already settled the item.
 *
 * counted − expected is right on its own while nothing else corrects the
 * item. Ordinary movements after the count (a truck leaving) are already in
 * both the shelf and the expected figure, so they need no help. What it
 * cannot see is another count landing in between. Two stocktakes over the
 * weights, counted 96 and then 98 against an expected 100, would each write
 * their own difference and leave 94. So corrections from other counts that
 * were applied after this line was counted are taken off, and if one of those
 * counts was itself taken after this line, it is the newer look at the shelf
 * and this line steps aside.
 */
export function settledDelta(
  count: StocktakeCount,
  stocktakeId: string,
  movements: Movement[],
  otherLines: Map<string, StocktakeCount[]>,
): number | null {
  if (count.counted === null || !count.countedAt) return null;
  const countedAt = count.countedAt;
  const since = movements.filter(
    (movement) =>
      !movement.deletedAt &&
      movement.itemId === count.itemId &&
      movement.reason === 'stocktake' &&
      movement.createdAt > countedAt &&
      !(movement.refType === 'stocktake' && movement.refId === stocktakeId),
  );
  if (since.some((movement) => countTimeFor(movement, otherLines) > countedAt)) return null;
  const applied = since.reduce((sum, movement) => sum + movement.qty, 0);
  return round2(deltaFor(count) - applied);
}

/**
 * Close a stocktake, writing every discrepancy to the ledger. Uncounted lines
 * are left alone. A partial count never zeroes out stock nobody looked at.
 */
export async function completeStocktake(stocktake: Stocktake, by = ''): Promise<number> {
  // Read fresh: a second tap on Apply, or another phone, may have closed it.
  const current = await db.stocktakes.get(stocktake.id);
  if (!current || current.status !== 'open') return 0;
  const counts = (await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id)).filter(
    (count) => count.counted !== null,
  );

  const itemIds = [...new Set(counts.map((count) => count.itemId))];
  const movements = itemIds.length ? await db.movements.where('itemId').anyOf(itemIds).toArray() : [];
  const otherIds = new Set<string>();
  for (const movement of movements) {
    if (movement.refType === 'stocktake' && movement.refId && movement.refId !== stocktake.id) {
      otherIds.add(movement.refId);
    }
  }
  const otherLines = new Map<string, StocktakeCount[]>();
  for (const id of otherIds) {
    otherLines.set(id, await liveWhere(db.stocktakeCounts, 'stocktakeId', id));
  }

  const corrections = counts.flatMap((count) => {
    const qty = settledDelta(count, stocktake.id, movements, otherLines);
    if (!qty) return [];
    return [
      {
        itemId: count.itemId,
        qty,
        reason: 'stocktake' as const,
        refType: 'stocktake' as const,
        refId: stocktake.id,
        note: stocktake.name,
        by: by || count.countedBy,
      },
    ];
  });

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

/** What the home screen needs to say about counting still to do. */
export interface UncountedSummary {
  /** Where the card goes. */
  href: string;
  title: string;
  detail: string;
  /** Lines left in the open stocktake, or items never counted at all. */
  remaining: number;
  /** The open stocktake the card points at, if there is one. */
  stocktakeId: string | null;
}

/**
 * The counting still to do, for a card on the home screen, or null when
 * there is none.
 *
 * An open stocktake with lines left comes first: somebody has started it and
 * finishing it is the quickest win. Otherwise, items that have never been
 * counted at all, which a catalogue imported from a packing list is full of.
 */
export async function uncountedSummary(): Promise<UncountedSummary | null> {
  const open = (await db.stocktakes.toArray())
    .filter((stocktake) => !stocktake.deletedAt && stocktake.status === 'open')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const stocktake of open) {
    const summary = summarise(await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id));
    if (!summary.remaining) continue;
    return {
      href: `/stocktake/${stocktake.id}`,
      title: `${stocktake.name} is still going`,
      detail: `${plural(summary.remaining, 'item')} of ${summary.total} still to count`,
      remaining: summary.remaining,
      stocktakeId: stocktake.id,
    };
  }

  const counted = await countedItemIds();
  const never = (await db.items.toArray()).filter(
    (item) => !item.deletedAt && isUncounted(item, counted),
  );
  if (!never.length) return null;
  return {
    href: '/stocktake',
    title:
      never.length === 1 ? 'One item has never been counted' : `${never.length} items have never been counted`,
    detail: 'Count them so low stock means low stock',
    remaining: never.length,
    stocktakeId: null,
  };
}
