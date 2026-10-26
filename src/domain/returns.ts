import { db } from '../db/db';
import { alive, update } from '../db/repo';
import { expectedHome } from './moves';
import { isConfirmed, received } from './packlists';
import { recordMovements, round2 } from './stock';
import type { Destination, Item, PacklistLine } from '../db/types';

/**
 * Counting it home.
 *
 * The mirror of the pull list: one line per item that went out, with what
 * should come back and what has been counted back. What should come back is
 * what each station said was left, or went back in the van; a consumable
 * nobody counted is assumed used, so nothing is booked onto the shelf that
 * nobody saw. Gear that went out on the truck and never reached a van is
 * expected back with the truck.
 *
 * Booking is the one place stock comes back into the warehouse, and it can
 * never book back more of an item than left the warehouse for the event.
 * Counting a station's gear home is not proof the warehouse ever let it go:
 * a van ticked with gear that was never on the truck, booked home, used to
 * make tables out of nothing.
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
  /**
   * Counted home beyond what left the warehouse for the event. Booking stops
   * at what went out, so this much needs a stocktake or a receipt instead.
   */
  overIssued: number;
  /**
   * What booking now would do to the shelf: positive goes back on, negative
   * comes off (a count lowered after it was booked). Never past what went out.
   */
  toBook: number;
  /** True when some share's count differs from what was last booked. */
  changed: boolean;
  going: HomeShare[];
}

/**
 * The change booking makes to one item's stock: what is counted home, capped
 * at what went out, less what that came to last time. One rule for the
 * screen's preview and the booking itself, so the two always agree.
 */
export function bookingDelta(issued: number, bookedBefore: number, bookedAfter: number): number {
  return round2(Math.min(bookedAfter, issued) - Math.min(bookedBefore, issued));
}

export interface HomeList {
  lines: HomeLine[];
  stations: number;
}

/**
 * What has left the warehouse's count against a line. Every way stock goes
 * out (the truck, the vehicles, a list marked loaded) records it on the line,
 * so the line is the record; a list's status is not, since booking returns
 * moves it on too.
 */
export function issuedOn(line: PacklistLine): number {
  return line.qtyIssued ?? 0;
}

/** Did anything leave the warehouse against this line, or come to it from another station? */
function wentOut(line: PacklistLine): boolean {
  return (
    line.qtyPacked > 0 ||
    (line.qtyOnTruck ?? 0) > 0 ||
    (line.qtyIssued ?? 0) > 0 ||
    Boolean(line.fromDestinationId)
  );
}

/**
 * How many of a station's line moved on to other stations instead of coming
 * home: what the receiving stations confirmed, or failing that what they were
 * due. Keyed by line id.
 */
export function forwardedFrom(
  lines: PacklistLine[],
  destinationOf: (line: PacklistLine) => string | undefined,
): Map<string, number> {
  const forwarded = new Map<string, number>();
  // Source lines by station and item, so a transfer finds what it came out of.
  const sources = new Map<string, PacklistLine>();
  for (const line of lines) {
    if (line.fromDestinationId) continue;
    const key = `${destinationOf(line)}|${line.itemId}`;
    if (!sources.has(key)) sources.set(key, line);
  }
  for (const line of lines) {
    if (!line.fromDestinationId) continue;
    const source = sources.get(`${line.fromDestinationId}|${line.itemId}`);
    if (!source) continue;
    const moved = isConfirmed(line) ? received(line) : line.qtyRequired;
    forwarded.set(source.id, round2((forwarded.get(source.id) ?? 0) + moved));
  }
  return forwarded;
}

export async function homeListFor(eventId: string): Promise<HomeList> {
  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  const items = alive(await db.items.toArray());
  const byDestination = new Map(destinations.map((destination) => [destination.id, destination]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const packlistById = new Map(packlists.map((packlist) => [packlist.id, packlist]));
  const eventLines = alive(await db.packlistLines.toArray()).filter((line) => packlistById.has(line.packlistId));
  const lines = eventLines.filter(wentOut);
  const destinationOf = (line: PacklistLine) => packlistById.get(line.packlistId)?.destinationId;
  const forwarded = forwardedFrom(eventLines, destinationOf);

  const grouped = new Map<string, HomeLine>();
  const issuedByItem = new Map<string, number>();
  const bookedByItem = new Map<string, number>();
  const stations = new Set<string>();
  for (const line of lines) {
    const packlist = packlistById.get(line.packlistId)!;
    const destination = byDestination.get(packlist.destinationId);
    if (!destination) continue;
    stations.add(destination.id);
    const item = itemById.get(line.itemId);
    // What moved on to the next station comes home from there, not from here.
    const expected = round2(
      Math.max(0, expectedHome(line, Boolean(item?.consumable)) - (forwarded.get(line.id) ?? 0)),
    );
    const issued = issuedOn(line);
    const sent = line.fromDestinationId ? 0 : Math.max(line.qtyPacked, line.qtyOnTruck ?? 0, issued);
    issuedByItem.set(line.itemId, round2((issuedByItem.get(line.itemId) ?? 0) + issued));

    let row = grouped.get(line.itemId);
    if (!row) {
      row = {
        item, itemId: line.itemId, sent: 0, expected: 0, counted: 0, unbooked: 0, gap: 0, overIssued: 0,
        toBook: 0, changed: false, going: [],
      };
      grouped.set(line.itemId, row);
    }
    row.sent = round2(row.sent + sent);
    row.expected = round2(row.expected + expected);
    row.counted = round2(row.counted + line.qtyReturned);
    row.unbooked = round2(row.unbooked + Math.max(0, line.qtyReturned - (line.qtyBooked ?? 0)));
    if (line.qtyReturned !== (line.qtyBooked ?? 0)) row.changed = true;
    bookedByItem.set(line.itemId, round2((bookedByItem.get(line.itemId) ?? 0) + (line.qtyBooked ?? 0)));
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
    const issued = issuedByItem.get(row.itemId) ?? 0;
    row.overIssued = round2(Math.max(0, row.counted - issued));
    row.toBook = bookingDelta(issued, bookedByItem.get(row.itemId) ?? 0, row.counted);
    row.going.sort((a, b) => a.destination.sort - b.destination.sort || a.destination.name.localeCompare(b.destination.name));
  }

  return {
    lines: [...grouped.values()].sort(
      (a, b) =>
        (a.item?.bin ?? '').localeCompare(b.item?.bin ?? '', undefined, { numeric: true }) ||
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
 * Safe to press again, and from two phones at once: it runs as one
 * transaction, and each item books only the change since the last booking.
 * That change can be negative: a count lowered after it was booked takes the
 * difference back off the shelf. Nothing books past what went out.
 *
 * `onlyPacklists` narrows it to some lists (a list reconciled on its own);
 * the cap is still worked out across the whole event, because gear moved
 * between stations leaves on one list and comes home on another.
 */
export async function bookReturns(
  eventId: string,
  by = '',
  onlyPacklists?: ReadonlySet<string>,
): Promise<{ lines: number; units: number }> {
  return db.transaction('rw', [db.packlistLines, db.packlists, db.items, db.movements, db.events], async () => {
    const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
    const byId = new Map(packlists.map((packlist) => [packlist.id, packlist]));
    const lines = alive(await db.packlistLines.toArray()).filter((line) => byId.has(line.packlistId));

    const byItem = new Map<string, PacklistLine[]>();
    for (const line of lines) {
      const group = byItem.get(line.itemId) ?? [];
      group.push(line);
      byItem.set(line.itemId, group);
    }

    const movements: Parameters<typeof recordMovements>[0] = [];
    const touchedLines: PacklistLine[] = [];
    for (const [itemId, group] of byItem) {
      const issued = round2(group.reduce((sum, line) => sum + issuedOn(line), 0));
      const bookedBefore = round2(group.reduce((sum, line) => sum + (line.qtyBooked ?? 0), 0));
      const changing = group.filter(
        (line) => (!onlyPacklists || onlyPacklists.has(line.packlistId)) && line.qtyReturned !== (line.qtyBooked ?? 0),
      );
      if (!changing.length) continue;
      const bookedAfter = round2(
        bookedBefore + changing.reduce((sum, line) => sum + line.qtyReturned - (line.qtyBooked ?? 0), 0),
      );
      // On the shelf is what was counted home, never more than went out.
      const qty = bookingDelta(issued, bookedBefore, bookedAfter);
      touchedLines.push(...changing);
      if (qty === 0) continue;
      const first = changing[0];
      movements.push({
        itemId,
        qty,
        reason: 'return',
        refType: 'packlist',
        refId: first.packlistId,
        note: `${qty < 0 ? 'Home count lowered' : 'Home'} · ${
          changing.length > 1 ? `${changing.length} stations` : byId.get(first.packlistId)?.name ?? ''
        }`,
        by,
      });
    }

    await recordMovements(movements);
    for (const line of touchedLines) await update(db.packlistLines, line.id, { qtyBooked: line.qtyReturned });
    const touched = new Set(touchedLines.filter((line) => line.qtyReturned > 0).map((line) => line.packlistId));
    for (const packlistId of touched) {
      const packlist = byId.get(packlistId);
      if (packlist && packlist.status !== 'reconciled') await update(db.packlists, packlistId, { status: 'reconciled' });
    }
    if (touchedLines.length) await update(db.events, eventId, { truckUnloadedAt: new Date().toISOString() });

    return {
      lines: touchedLines.length,
      units: round2(movements.reduce((sum, movement) => sum + movement.qty, 0)),
    };
  });
}

/**
 * Gear still out against a station's lists: issued and not yet booked home.
 * A station with any is not safe to delete, or the gear drops off the count
 * home for good.
 */
export async function gearStillOut(destinationId: string): Promise<number> {
  const packlists = alive(await db.packlists.where('destinationId').equals(destinationId).toArray());
  let out = 0;
  for (const packlist of packlists) {
    for (const line of alive(await db.packlistLines.where('packlistId').equals(packlist.id).toArray())) {
      out += Math.max(0, issuedOn(line) - (line.qtyBooked ?? 0));
    }
  }
  return round2(out);
}
