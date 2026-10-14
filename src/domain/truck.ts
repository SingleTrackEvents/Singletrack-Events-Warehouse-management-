import { db } from '../db/db';
import { alive, update } from '../db/repo';
import { hasIssued } from './packlists';
import { recordMovements, round2 } from './stock';
import type { Category, PacklistLine } from '../db/types';
import type { PullDestination } from './warehouse';

/**
 * Two-stage packing: the truck, then the vans.
 *
 * Most events go out of the warehouse in one big truck. At the event the
 * truck is unpacked into a van per aid station. So the warehouse list ticks
 * gear onto the truck, the truck being loaded is what takes it out of the
 * warehouse count, and each station's packlist becomes the van pack, ordered
 * so the first thing the station needs is the last thing into the van.
 */

/** Tick a share of an item onto the truck, or off it. */
export async function setOnTruck(shares: PullDestination[], onTruck: boolean): Promise<number> {
  let changed = 0;
  for (const share of shares) {
    if (!share.canPack) continue;
    const qty = onTruck ? share.qtyRequired : 0;
    if ((share.qtyOnTruck ?? 0) === qty) continue;
    await update(db.packlistLines, share.lineId, { qtyOnTruck: qty });
    changed += 1;
  }
  return changed;
}

/**
 * Mark the truck loaded: take what is on it out of the warehouse count.
 *
 * Safe to press again after a late addition: each line only issues what is on
 * the truck beyond what has already gone out against it. Lists already loaded
 * at the warehouse took their own stock and are left alone.
 */
export async function loadTruck(
  eventId: string,
  by = '',
): Promise<{ lines: number; units: number }> {
  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray()).filter(
    (packlist) => !hasIssued(packlist.status),
  );
  const byId = new Map(packlists.map((packlist) => [packlist.id, packlist]));
  const lines = alive(await db.packlistLines.toArray()).filter((line) => byId.has(line.packlistId));

  const owed = lines
    .map((line) => ({ line, qty: round2((line.qtyOnTruck ?? 0) - (line.qtyIssued ?? 0)) }))
    .filter(({ qty }) => qty > 0);

  await recordMovements(
    owed.map(({ line, qty }) => ({
      itemId: line.itemId,
      qty: -qty,
      reason: 'issue' as const,
      refType: 'packlist' as const,
      refId: line.packlistId,
      note: `Truck · ${byId.get(line.packlistId)?.name ?? ''}`,
      by,
    })),
  );
  for (const { line } of owed) await update(db.packlistLines, line.id, { qtyIssued: line.qtyOnTruck });
  await update(db.events, eventId, { truckLoadedAt: new Date().toISOString() });

  return { lines: owed.length, units: round2(owed.reduce((sum, { qty }) => sum + qty, 0)) };
}

/**
 * The order an aid station sets up in, and so unloads in.
 *
 * Shelter first, because nothing else happens until the marquees are up and
 * weighted down; then tables, power and light; then water, ice and the kit;
 * the food and the bins last. A van is packed the other way round.
 */
export const SETUP_ORDER = [
  'Structure & Shelter',
  'Anchoring & Weights',
  'Furniture & Site Equipment',
  'Power & Cabling',
  'Lighting',
  'Water & Ice',
  'Cold Chain & Drop Bags',
  'Cooking & Heating',
  'Aid Station Kits',
  'Serving & Catering',
  'Aid Station Food & Drink',
  'Hygiene & Consumables',
  'Medical & Welfare',
  'Waste Management',
  'Comms & AV',
  'Course Marking & Traffic',
  'Event Village & Branding',
  'Registration, Merch & Timing',
  'Tools & Hardware',
  'Fire (where permitted)',
  'Other / Review',
];

/** Where a category falls in the setup order; one nobody has placed goes in the middle. */
function setupRank(categoryName: string | undefined): number {
  const at = categoryName ? SETUP_ORDER.indexOf(categoryName) : -1;
  return at >= 0 ? at : Math.floor(SETUP_ORDER.length / 2);
}

/**
 * Lines in unload order: what the station needs first, first.
 *
 * A line the crew has placed keeps its place; everything else follows the
 * setup order by category, then the list's own order.
 */
export function unloadOrder(
  lines: PacklistLine[],
  categoryOf: (line: PacklistLine) => Category | undefined,
): PacklistLine[] {
  const key = (line: PacklistLine) =>
    line.vanOrder ?? (setupRank(categoryOf(line)?.name) + 1) * 1000 + line.sort / 1000;
  return [...lines].sort((a, b) => key(a) - key(b));
}

/**
 * Move one line a place earlier (-1) or later (+1) in the unload order.
 *
 * The whole list is written down in its current order first, so moving one
 * line never reshuffles the rest.
 */
export async function moveInVan(ordered: PacklistLine[], lineId: string, by: -1 | 1): Promise<void> {
  const at = ordered.findIndex((line) => line.id === lineId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= ordered.length) return;
  const next = [...ordered];
  [next[at], next[to]] = [next[to], next[at]];
  for (const [index, line] of next.entries()) {
    const vanOrder = (index + 1) * 10;
    if (line.vanOrder !== vanOrder) await update(db.packlistLines, line.id, { vanOrder });
  }
}

/** Put a list back on the default setup order. */
export async function resetVanOrder(lines: PacklistLine[]): Promise<void> {
  for (const line of lines) {
    if (line.vanOrder !== undefined && line.vanOrder !== null) {
      await update(db.packlistLines, line.id, { vanOrder: null });
    }
  }
}
