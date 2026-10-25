import { db } from '../db/db';
import { alive, update } from '../db/repo';
import { hasIssued } from './packlists';
import { recordMovements, round2 } from './stock';
import type { Category, Destination, Item, PacklistLine, TruckRun } from '../db/types';
import type { LineSnapshot, PullDestination } from './warehouse';

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
export async function setOnTruck(shares: PullDestination[], onTruck: boolean): Promise<LineSnapshot[]> {
  const before: LineSnapshot[] = [];
  for (const share of shares) {
    if (!share.canPack || share.fromDestination) continue;
    const qty = onTruck ? share.qtyRequired : 0;
    if ((share.qtyOnTruck ?? 0) === qty) continue;
    before.push({ lineId: share.lineId, qty: share.qtyOnTruck ?? 0 });
    await update(db.packlistLines, share.lineId, { qtyOnTruck: qty });
  }
  return before;
}

/**
 * The one place stock leaves the warehouse: the load is called loaded.
 *
 * On a truck-then-vans event that is what is on the truck; on an event
 * loaded straight into each station's vehicle it is what is packed. Safe to
 * press again after a late addition: each line only issues what is loaded
 * beyond what has already gone out against it, and gear taken back off the
 * truck before it left (to make room for the Beechworth pallet) goes back on
 * the count. Lists loaded the old way, by their own status, took their own
 * stock and are left alone, and gear moving on from another station never
 * left the warehouse a second time.
 *
 * One transaction, so two phones pressing it together, or one finger
 * pressing it three times, take the stock out once.
 */
export async function issueLoaded(
  eventId: string,
  truckStage: boolean,
  by = '',
): Promise<{ lines: number; units: number; returned: number }> {
  return db.transaction('rw', [db.packlistLines, db.packlists, db.items, db.movements, db.events], async () => {
    const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray()).filter(
      (packlist) => !hasIssued(packlist.status),
    );
    const byId = new Map(packlists.map((packlist) => [packlist.id, packlist]));
    const lines = alive(await db.packlistLines.toArray()).filter(
      (line) => byId.has(line.packlistId) && !line.fromDestinationId,
    );
    const loaded = (line: PacklistLine) => (truckStage ? line.qtyOnTruck ?? 0 : line.qtyPacked);

    // Taken back off only while nothing of the line has been booked home:
    // after that the return count is the record of where it went.
    const changed = lines
      .map((line) => ({ line, qty: round2(loaded(line) - (line.qtyIssued ?? 0)) }))
      .filter(({ line, qty }) => qty > 0 || (qty < 0 && !(line.qtyBooked ?? 0)));
    const owed = changed.filter(({ qty }) => qty > 0);
    const offTruck = changed.filter(({ qty }) => qty < 0);
    const where = truckStage ? 'Truck' : 'Loaded';

    await recordMovements([
      ...owed.map(({ line, qty }) => ({
        itemId: line.itemId,
        qty: -qty,
        reason: 'issue' as const,
        refType: 'packlist' as const,
        refId: line.packlistId,
        note: `${where} · ${byId.get(line.packlistId)?.name ?? ''}`,
        by,
      })),
      ...offTruck.map(({ line, qty }) => ({
        itemId: line.itemId,
        qty: -qty,
        reason: 'return' as const,
        refType: 'packlist' as const,
        refId: line.packlistId,
        note: `Taken off before it left · ${byId.get(line.packlistId)?.name ?? ''}`,
        by,
      })),
    ]);
    for (const { line } of changed) await update(db.packlistLines, line.id, { qtyIssued: loaded(line) });

    const result = {
      lines: owed.length,
      units: round2(owed.reduce((sum, { qty }) => sum + qty, 0)),
      returned: round2(offTruck.reduce((sum, { qty }) => sum - qty, 0)),
    };
    if (changed.length) {
      const event = await db.events.get(eventId);
      const at = new Date().toISOString();
      const run: TruckRun = { at, by, ...result };
      await update(db.events, eventId, { truckLoadedAt: at, truckRuns: [...(event?.truckRuns ?? []), run] });
    }
    return result;
  });
}

/** Mark the truck loaded: take what is on it out of the warehouse count. */
export async function loadTruck(eventId: string, by = ''): Promise<{ lines: number; units: number; returned: number }> {
  return issueLoaded(eventId, true, by);
}

/** One station's share of an item still on the truck. */
export interface RemainderShare {
  destination: Destination;
  packlistId: string;
  lineId: string;
  onTruck: number;
  inVan: number;
  /** What the van should take: what went on for it, capped at what it needs. */
  wants: number;
}

/** One item, as the truck empties into the vans. */
export interface RemainderLine {
  item: Item | undefined;
  itemId: string;
  onTruck: number;
  inVans: number;
  /** Still on the truck: on it, less what the vans have taken. */
  remaining: number;
  /** Stations whose van has less of this than went on the truck for them. */
  short: RemainderShare[];
  /** Left on the truck with no station waiting for it. */
  spare: number;
}

/** One station's van, as a count of lines. */
export interface VanSummary {
  destination: Destination;
  packlistId: string;
  linesDone: number;
  linesTotal: number;
}

/**
 * What is still on the truck once the vans start taking from it.
 *
 * Ticking a line into a van moves that share from on-truck to in-van, so
 * the remainder is a subtraction, not a count anyone keeps. Gear a station
 * is still waiting for reads as short; gear with nowhere to go reads as
 * spare. An empty remainder with every van packed is the truck being empty,
 * which is the whole check.
 */
export async function remainderFor(eventId: string): Promise<{ lines: RemainderLine[]; vans: VanSummary[] }> {
  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  const items = alive(await db.items.toArray());
  const byDestination = new Map(destinations.map((destination) => [destination.id, destination]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const packlistById = new Map(packlists.map((packlist) => [packlist.id, packlist]));
  const lines = alive(await db.packlistLines.toArray()).filter((line) => packlistById.has(line.packlistId));

  const grouped = new Map<string, RemainderLine>();
  const vans = new Map<string, VanSummary>();
  for (const line of lines) {
    // Gear moving on from another station never rides the truck.
    if (line.fromDestinationId) continue;
    const packlist = packlistById.get(line.packlistId)!;
    const destination = byDestination.get(packlist.destinationId);
    if (!destination) continue;
    const onTruck = line.qtyOnTruck ?? 0;
    const inVan = line.qtyPacked;
    // What this van should take: what went on the truck for it, capped at
    // what the station needs. Two extra on the truck are spare, not owed.
    const wants = onTruck > 0 ? Math.min(onTruck, line.qtyRequired > 0 ? line.qtyRequired : onTruck) : line.qtyRequired;

    let van = vans.get(packlist.id);
    if (!van) {
      van = { destination, packlistId: packlist.id, linesDone: 0, linesTotal: 0 };
      vans.set(packlist.id, van);
    }
    van.linesTotal += 1;
    if (wants > 0 && inVan >= wants) van.linesDone += 1;

    if (onTruck <= 0 && inVan <= 0) continue;
    let row = grouped.get(line.itemId);
    if (!row) {
      row = { item: itemById.get(line.itemId), itemId: line.itemId, onTruck: 0, inVans: 0, remaining: 0, short: [], spare: 0 };
      grouped.set(line.itemId, row);
    }
    row.onTruck = round2(row.onTruck + onTruck);
    row.inVans = round2(row.inVans + inVan);
    if (onTruck > 0 && inVan < wants) {
      row.short.push({ destination, packlistId: packlist.id, lineId: line.id, onTruck, inVan, wants });
    }
  }

  for (const row of grouped.values()) {
    row.remaining = round2(Math.max(0, row.onTruck - row.inVans));
    const waiting = row.short.reduce((sum, share) => sum + (share.wants - share.inVan), 0);
    row.spare = round2(Math.max(0, row.remaining - waiting));
    row.short.sort((a, b) => a.destination.sort - b.destination.sort || a.destination.name.localeCompare(b.destination.name));
  }

  return {
    lines: [...grouped.values()].sort(
      (a, b) =>
        Number(b.remaining > 0) - Number(a.remaining > 0) ||
        (a.item?.bin ?? '').localeCompare(b.item?.bin ?? '') ||
        (a.item?.name ?? '').localeCompare(b.item?.name ?? ''),
    ),
    vans: [...vans.values()].sort(yardOrder),
  };
}

/**
 * The order the yard packs vans in: by when each leaves Halls Gap, first
 * out first. GPT's vans go in a fixed order from 03:30 Thursday, so packing
 * by station order has the crew loading Saturday's van before Thursday's.
 * Stations with no departure time follow, in course order.
 */
export function yardOrder(a: { destination: Destination }, b: { destination: Destination }): number {
  const left = a.destination.schedule?.departsAt ?? '';
  const right = b.destination.schedule?.departsAt ?? '';
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  }
  return a.destination.sort - b.destination.sort || a.destination.name.localeCompare(b.destination.name);
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
