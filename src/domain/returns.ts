import { db } from '../db/db';
import { alive, update } from '../db/repo';
import { expectedHome } from './moves';
import { recordMovements, round2 } from './stock';
import type { Destination, Item, PacklistLine } from '../db/types';

/**
 * Counting it home.
 *
 * The mirror of the pull list: one line per item that went out, with what
 * should come back and what has been counted back. What should come back is
 * what each station said was left, or went back in the van; a consumable
 * nobody counted is assumed used, so nothing is booked onto the shelf that
 * nobody saw. Booking is the one place stock comes back into the warehouse,
 * and it only ever books what has not been booked already.
 */

/** One station's share of an item coming home. */
export interface HomeShare {
  destination: Destination;
  packlistId: string;
  lineId: string;
  expected: number;
  counted: number;
  /** True once the station itself put a number on what was left. */
  stationCounted: boolean;
}

export interface HomeLine {
  item: Item | undefined;
  itemId: string;
  /** What went out, in total. */
  sent: number;
  expected: number;
  counted: number;
  /** Counted home but not yet on the shelf. */
  unbooked: number;
  /** counted - expected: negative is missing, positive is more than expected. */
  gap: number;
  going: HomeShare[];
}

export interface HomeList {
  lines: HomeLine[];
  stations: number;
}

/** Did anything leave the shed against this line? */
function wentOut(line: PacklistLine): boolean {
  return line.qtyPacked > 0 || (line.qtyOnTruck ?? 0) > 0 || (line.qtyIssued ?? 0) > 0;
}

export async function homeListFor(eventId: string): Promise<HomeList> {
  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  const items = alive(await db.items.toArray());
  const byDestination = new Map(destinations.map((destination) => [destination.id, destination]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const packlistById = new Map(packlists.map((packlist) => [packlist.id, packlist]));
  const lines = alive(await db.packlistLines.toArray()).filter(
    (line) => packlistById.has(line.packlistId) && wentOut(line),
  );

  const grouped = new Map<string, HomeLine>();
  const stations = new Set<string>();
  for (const line of lines) {
    const packlist = packlistById.get(line.packlistId)!;
    const destination = byDestination.get(packlist.destinationId);
    if (!destination) continue;
    stations.add(destination.id);
    const item = itemById.get(line.itemId);
    const expected = expectedHome(line, Boolean(item?.consumable));
    const sent = Math.max(line.qtyPacked, line.qtyOnTruck ?? 0, line.qtyIssued ?? 0);

    let row = grouped.get(line.itemId);
    if (!row) {
      row = { item, itemId: line.itemId, sent: 0, expected: 0, counted: 0, unbooked: 0, gap: 0, going: [] };
      grouped.set(line.itemId, row);
    }
    row.sent = round2(row.sent + sent);
    row.expected = round2(row.expected + expected);
    row.counted = round2(row.counted + line.qtyReturned);
    row.unbooked = round2(row.unbooked + Math.max(0, line.qtyReturned - (line.qtyBooked ?? 0)));
    row.going.push({
      destination,
      packlistId: packlist.id,
      lineId: line.id,
      expected,
      counted: line.qtyReturned,
      stationCounted: line.qtyLeft !== undefined && line.qtyLeft !== null,
    });
  }

  for (const row of grouped.values()) {
    row.gap = round2(row.counted - row.expected);
    row.going.sort((a, b) => a.destination.sort - b.destination.sort || a.destination.name.localeCompare(b.destination.name));
  }

  return {
    lines: [...grouped.values()].sort(
      (a, b) =>
        (a.item?.bin ?? '').localeCompare(b.item?.bin ?? '') ||
        (a.item?.name ?? '').localeCompare(b.item?.name ?? ''),
    ),
    stations: stations.size,
  };
}

/** True when every share of this item has been counted home. */
export function isHome(line: HomeLine): boolean {
  return line.going.every((share) => share.counted >= share.expected);
}

/**
 * Tick an item home: every station's share counted at what was expected, or
 * back to nothing. The stepper on a share handles the odd one.
 */
export async function setHome(shares: HomeShare[], home: boolean): Promise<number> {
  let changed = 0;
  for (const share of shares) {
    const qty = home ? share.expected : 0;
    if (share.counted === qty) continue;
    await update(db.packlistLines, share.lineId, { qtyReturned: qty });
    changed += 1;
  }
  return changed;
}

/**
 * Book what has been counted home back onto the shelf.
 *
 * Safe to press again: each line books only what has been counted beyond
 * what was booked before. A list with anything booked is marked reconciled
 * so an older copy of the app reads it the same way.
 */
export async function bookReturns(eventId: string, by = ''): Promise<{ lines: number; units: number }> {
  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
  const byId = new Map(packlists.map((packlist) => [packlist.id, packlist]));
  const lines = alive(await db.packlistLines.toArray()).filter((line) => byId.has(line.packlistId));

  const owed = lines
    .map((line) => ({ line, qty: round2(line.qtyReturned - (line.qtyBooked ?? 0)) }))
    .filter(({ qty }) => qty > 0);

  await recordMovements(
    owed.map(({ line, qty }) => ({
      itemId: line.itemId,
      qty,
      reason: 'return' as const,
      refType: 'packlist' as const,
      refId: line.packlistId,
      note: `Home · ${byId.get(line.packlistId)?.name ?? ''}`,
      by,
    })),
  );
  for (const { line } of owed) await update(db.packlistLines, line.id, { qtyBooked: line.qtyReturned });
  const touched = new Set(owed.map(({ line }) => line.packlistId));
  for (const packlistId of touched) {
    const packlist = byId.get(packlistId);
    if (packlist && packlist.status !== 'reconciled') await update(db.packlists, packlistId, { status: 'reconciled' });
  }
  await update(db.events, eventId, { truckUnloadedAt: new Date().toISOString() });

  return { lines: owed.length, units: round2(owed.reduce((sum, { qty }) => sum + qty, 0)) };
}
