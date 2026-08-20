import { db, nowIso, stampNew, stampUpdate } from '../db/db';
import type { Item, Movement, MovementReason } from '../db/types';

/**
 * Stock movements.
 *
 * `Item.qtyOnHand` is a running cache; the `movements` table is the truth. Every
 * change to a quantity writes a ledger row recording who, why and the resulting
 * balance, so a surprising number on race morning can always be traced back.
 */

export interface MovementInput {
  itemId: string;
  /** Signed change in the item's unit. Negative removes stock. */
  qty: number;
  reason: MovementReason;
  refType?: Movement['refType'];
  refId?: string | null;
  note?: string;
  by?: string;
}

/** Compute the balance after a change, never letting stock go negative. */
export function applyDelta(current: number, delta: number): number {
  return Math.max(0, round2(current + delta));
}

/** Quantities are whole units in practice, but weights can be fractional. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Record one or more stock movements atomically, updating the item balances.
 * Returns the ledger rows that were written.
 */
export async function recordMovements(inputs: MovementInput[]): Promise<Movement[]> {
  const usable = inputs.filter((input) => input.qty !== 0);
  if (!usable.length) return [];

  return db.transaction('rw', db.items, db.movements, async () => {
    const written: Movement[] = [];
    for (const input of usable) {
      const item = await db.items.get(input.itemId);
      if (!item) continue;
      const balanceAfter = applyDelta(item.qtyOnHand, input.qty);
      await db.items.put(stampUpdate({ ...item, qtyOnHand: balanceAfter }));
      const movement: Movement = {
        ...stampNew(),
        itemId: input.itemId,
        qty: round2(input.qty),
        reason: input.reason,
        balanceAfter,
        refType: input.refType ?? 'manual',
        refId: input.refId ?? null,
        note: input.note ?? '',
        by: input.by ?? '',
      };
      await db.movements.put(movement);
      written.push(movement);
    }
    return written;
  });
}

/** Set an item to an absolute quantity, writing the difference to the ledger. */
export async function setQuantity(
  itemId: string,
  target: number,
  reason: MovementReason,
  options: { note?: string; by?: string; refType?: Movement['refType']; refId?: string | null } = {},
): Promise<Movement[]> {
  const item = await db.items.get(itemId);
  if (!item) return [];
  const delta = round2(target - item.qtyOnHand);
  if (delta === 0) return [];
  return recordMovements([{ itemId, qty: delta, reason, ...options }]);
}

/** True when an item has fallen to or below its reorder threshold. */
export function isLowStock(item: Item): boolean {
  return !item.archived && item.minQty > 0 && item.qtyOnHand <= item.minQty;
}

/** Items at or below their reorder point, most urgent first. */
export function lowStockItems(items: Item[]): Item[] {
  return items
    .filter(isLowStock)
    .sort((a, b) => shortfall(b) - shortfall(a));
}

/** How far below the reorder point an item sits. */
export function shortfall(item: Item): number {
  return round2(Math.max(0, item.minQty - item.qtyOnHand));
}

/** Total individual pieces represented by a quantity, e.g. 3 cartons of 24 = 72. */
export function pieces(item: Item, qty = item.qtyOnHand): number {
  return round2(qty * (item.packSize || 1));
}

/** The ledger for one item, newest first. */
export async function itemHistory(itemId: string, limit = 50): Promise<Movement[]> {
  const rows = await db.movements.where('itemId').equals(itemId).toArray();
  return rows
    .filter((row) => !row.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Human wording for a ledger reason. */
export const MOVEMENT_LABELS: Record<MovementReason, string> = {
  receipt: 'Received',
  issue: 'Issued to event',
  return: 'Returned from event',
  stocktake: 'Stocktake correction',
  adjustment: 'Manual adjustment',
  consumed: 'Consumed at event',
  damaged: 'Damaged / written off',
  transfer: 'Transferred',
};

/** Timestamp helper re-exported so screens do not reach into the db module. */
export { nowIso };
