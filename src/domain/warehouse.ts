import { db } from '../db/db';
import { alive } from '../db/repo';
import { countedItemIds, round2 } from './stock';
import type { Destination, Item, Load, Packlist } from '../db/types';

/**
 * The warehouse pull list.
 *
 * Once every destination has a packlist, the question in the shed changes.
 * A packlist answers "what goes to Aid 3"; nobody walks the racks eleven times.
 * What the warehouse needs is one line per item with the total across the whole
 * event, and — standing there holding 155 trestle tables — where they are going
 * and which vehicle takes them.
 *
 * Entirely derived. No new records, nothing to keep in step: change a packlist
 * and the pull list is already right. The vehicle a thing travels in comes from
 * the run its destination is on, so this cannot contradict the transport plan —
 * a destination on no run yet says exactly that instead of guessing.
 */

/** Where a share of an item is going, and how it gets there. */
export interface PullDestination {
  destination: Destination;
  qtyRequired: number;
  qtyPacked: number;
  packlistId: string;
  /** The run carrying this destination, if it is on one yet. */
  load: Load | undefined;
}

export interface PullLine {
  item: Item | undefined;
  itemId: string;
  qtyRequired: number;
  qtyPacked: number;
  /** On hand in the warehouse right now. */
  qtyOnHand: number;
  /** How far short the warehouse is of the total. Zero when it covers it. */
  shortfall: number;
  /** True when nothing has ever been counted, so "short" would be a guess. */
  uncounted: boolean;
  going: PullDestination[];
}

export interface PullList {
  lines: PullLine[];
  /** Destinations with a packlist but no run yet — gear with no way to travel. */
  unassigned: Destination[];
  /** Runs for this event, in the order they were created. */
  loads: Load[];
  destinationsCovered: number;
  packlistsCounted: number;
}

/** Everything the event needs out of the warehouse, one line per item. */
export async function pullListFor(eventId: string): Promise<PullList> {
  const packlists = alive(await db.packlists.toArray()).filter(
    (packlist) => packlist.eventId === eventId,
  );
  const destinations = alive(await db.destinations.toArray()).filter(
    (destination) => destination.eventId === eventId,
  );
  const loads = alive(await db.loads.toArray()).filter((load) => load.eventId === eventId);
  const stops = alive(await db.loadStops.toArray());
  const items = alive(await db.items.toArray());

  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const counted = await countedItemIds();

  // Destination to the run carrying it. A destination on two runs takes the
  // first: splitting one station across vehicles is a transport decision the
  // pull list reports rather than makes.
  const loadById = new Map(loads.map((load) => [load.id, load]));
  const carriedBy = new Map<string, Load>();
  for (const stop of stops) {
    const load = loadById.get(stop.loadId);
    if (load && !carriedBy.has(stop.destinationId)) carriedBy.set(stop.destinationId, load);
  }

  const packlistById = new Map(packlists.map((packlist) => [packlist.id, packlist]));
  const lines = alive(await db.packlistLines.toArray()).filter((line) =>
    packlistById.has(line.packlistId),
  );

  const grouped = new Map<string, PullLine>();
  for (const line of lines) {
    const packlist = packlistById.get(line.packlistId) as Packlist;
    const destination = byId.get(packlist.destinationId);
    if (!destination) continue;

    let row = grouped.get(line.itemId);
    if (!row) {
      const item = itemById.get(line.itemId);
      row = {
        item,
        itemId: line.itemId,
        qtyRequired: 0,
        qtyPacked: 0,
        qtyOnHand: item?.qtyOnHand ?? 0,
        shortfall: 0,
        uncounted: Boolean(item) && item!.qtyOnHand === 0 && !counted.has(line.itemId),
        going: [],
      };
      grouped.set(line.itemId, row);
    }

    row.qtyRequired = round2(row.qtyRequired + line.qtyRequired);
    row.qtyPacked = round2(row.qtyPacked + line.qtyPacked);
    row.going.push({
      destination,
      qtyRequired: line.qtyRequired,
      qtyPacked: line.qtyPacked,
      packlistId: packlist.id,
      load: carriedBy.get(destination.id),
    });
  }

  for (const row of grouped.values()) {
    // Uncounted stock is not a shortfall: nobody has looked at the shelf, and
    // reporting a shortage against a number that was never counted sends
    // someone shopping for gear that is probably already in the shed.
    row.shortfall = row.uncounted ? 0 : round2(Math.max(0, row.qtyRequired - row.qtyOnHand));
    // Course order, so the breakdown reads the way the race runs.
    row.going.sort(
      (a, b) =>
        (a.destination.courseKm ?? Number.MAX_SAFE_INTEGER) -
          (b.destination.courseKm ?? Number.MAX_SAFE_INTEGER) ||
        a.destination.sort - b.destination.sort ||
        a.destination.name.localeCompare(b.destination.name),
    );
  }

  const withPacklists = new Set(packlists.map((packlist) => packlist.destinationId));

  return {
    // Bin order: you walk the racks, not the alphabet.
    lines: [...grouped.values()].sort(
      (a, b) =>
        (a.item?.bin ?? '').localeCompare(b.item?.bin ?? '') ||
        (a.item?.name ?? '').localeCompare(b.item?.name ?? ''),
    ),
    unassigned: destinations.filter(
      (destination) => withPacklists.has(destination.id) && !carriedBy.has(destination.id),
    ),
    loads,
    destinationsCovered: withPacklists.size,
    packlistsCounted: packlists.length,
  };
}

/** One vehicle's share of the pull list. */
export interface VehicleLoad {
  load: Load | undefined;
  /** Total per item for the destinations this vehicle carries. */
  lines: Array<{ item: Item | undefined; itemId: string; qtyRequired: number; qtyPacked: number }>;
  destinations: Destination[];
}

/**
 * The same totals split by vehicle, for loading rather than picking.
 *
 * The undefined load at the end holds anything whose destination is not on a
 * run yet — gear that has been packed with no way of getting there, which is
 * worth seeing before race morning rather than on it.
 */
export function byVehicle(list: PullList): VehicleLoad[] {
  const groups = new Map<string, VehicleLoad>();
  const key = (load: Load | undefined) => load?.id ?? '__none';

  for (const line of list.lines) {
    for (const going of line.going) {
      const id = key(going.load);
      let group = groups.get(id);
      if (!group) {
        group = { load: going.load, lines: [], destinations: [] };
        groups.set(id, group);
      }
      if (!group.destinations.some((entry) => entry.id === going.destination.id)) {
        group.destinations.push(going.destination);
      }
      const existing = group.lines.find((entry) => entry.itemId === line.itemId);
      if (existing) {
        existing.qtyRequired = round2(existing.qtyRequired + going.qtyRequired);
        existing.qtyPacked = round2(existing.qtyPacked + going.qtyPacked);
      } else {
        group.lines.push({
          item: line.item,
          itemId: line.itemId,
          qtyRequired: going.qtyRequired,
          qtyPacked: going.qtyPacked,
        });
      }
    }
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (!a.load) return 1;
    if (!b.load) return -1;
    return a.load.createdAt.localeCompare(b.load.createdAt);
  });
  for (const group of ordered) {
    group.lines.sort(
      (a, b) =>
        (a.item?.bin ?? '').localeCompare(b.item?.bin ?? '') ||
        (a.item?.name ?? '').localeCompare(b.item?.name ?? ''),
    );
  }
  return ordered;
}

/** Rows for the CSV export, one line per item with its destinations spelled out. */
export function pullListCsv(list: PullList): string[][] {
  return [
    ['Item', 'SKU', 'Bin', 'Total needed', 'Packed', 'On hand', 'Short by', 'Going to'],
    ...list.lines.map((line) => [
      line.item?.name ?? 'Unknown item',
      line.item?.sku ?? '',
      line.item?.bin ?? '',
      String(line.qtyRequired),
      String(line.qtyPacked),
      line.uncounted ? 'not counted' : String(line.qtyOnHand),
      line.shortfall ? String(line.shortfall) : '',
      line.going
        .map((going) => `${going.destination.name} ×${going.qtyRequired}`)
        .join('; '),
    ]),
  ];
}
