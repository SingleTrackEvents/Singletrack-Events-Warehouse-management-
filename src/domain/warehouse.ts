import { db } from '../db/db';
import { alive, update } from '../db/repo';
import { hasIssued } from './packlists';
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
 * and the pull list is already right. The vehicle a thing travels in is the
 * tag on its destination ("Van 3", "Hilux"), so a destination with no vehicle
 * yet says exactly that instead of guessing.
 */

/** Where a share of an item is going, and how it gets there. */
export interface PullDestination {
  destination: Destination;
  qtyRequired: number;
  qtyPacked: number;
  /** Two-stage events: how much of this share is on the truck. */
  qtyOnTruck: number;
  packlistId: string;
  /** The packlist line behind this share, for ticking it off from here. */
  lineId: string;
  /** False once the list has been loaded: stock has left, so the count is fixed. */
  canPack: boolean;
  /** The vehicle carrying this destination, if it has one yet. */
  vehicle: string | undefined;
  /**
   * The station this share comes from instead of the warehouse, by name.
   * Shown so the crew can see where it is coming from, never picked here.
   */
  fromDestination?: string;
}

export interface PullLine {
  item: Item | undefined;
  itemId: string;
  qtyRequired: number;
  qtyPacked: number;
  /** Two-stage events: how much of the total is on the truck. */
  qtyOnTruck: number;
  /** On hand in the warehouse right now. */
  qtyOnHand: number;
  /** How far short the warehouse is of the total. Zero when it covers it. */
  shortfall: number;
  /** Already out of the warehouse count for these lines (on the truck, loaded). */
  qtyIssued: number;
  /** Needed, but coming from another station rather than the warehouse. */
  qtyFromStations: number;
  /** True when nothing has ever been counted, so "short" would be a guess. */
  uncounted: boolean;
  going: PullDestination[];
}

export interface PullList {
  lines: PullLine[];
  /** Destinations with a packlist but no vehicle yet — gear with no way to travel. */
  unassigned: Destination[];
  /** Every vehicle named on this event's destinations. */
  vehicles: string[];
  destinationsCovered: number;
  packlistsCounted: number;
}

/**
 * The vehicle a destination travels in: its own tag, or the run it was put on
 * before vehicles were tags. The run is read, never written, so a transport
 * plan made the old way still shows up until the tags take over.
 */
export function vehicleOf(destination: Destination, run?: Load): string | undefined {
  const tag = destination.vehicle?.trim();
  if (tag) return tag;
  if (run) return run.vehicle.trim() || run.name.trim() || undefined;
  return undefined;
}

/** Vehicle names in a sensible order: Van 2 before Van 10, unassigned last. */
export function compareVehicles(a: string | undefined, b: string | undefined): number {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Write the old transport plan onto the destinations as vehicle tags, once.
 *
 * A destination that already carries a tag is left alone; one on a run and
 * without a tag takes the run's vehicle. Returns how many were tagged.
 */
export async function adoptVehiclesFromLoads(eventId: string): Promise<number> {
  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  const loads = alive(await db.loads.where('eventId').equals(eventId).toArray());
  if (!loads.length) return 0;
  const stops = alive(await db.loadStops.toArray());
  const loadById = new Map(loads.map((load) => [load.id, load]));
  let tagged = 0;
  for (const destination of destinations) {
    if (destination.vehicle?.trim()) continue;
    const stop = stops.find((entry) => entry.destinationId === destination.id && loadById.has(entry.loadId));
    const vehicle = stop ? vehicleOf(destination, loadById.get(stop.loadId)) : undefined;
    if (!vehicle) continue;
    await update(db.destinations, destination.id, { vehicle });
    tagged += 1;
  }
  return tagged;
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

  // Destination to the run carrying it, for destinations tagged before
  // vehicles were tags. A destination on two runs takes the first.
  const loadById = new Map(loads.map((load) => [load.id, load]));
  const carriedBy = new Map<string, Load>();
  for (const stop of stops) {
    const load = loadById.get(stop.loadId);
    if (load && !carriedBy.has(stop.destinationId)) carriedBy.set(stop.destinationId, load);
  }
  const vehicleFor = (destination: Destination) => vehicleOf(destination, carriedBy.get(destination.id));

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
        qtyOnTruck: 0,
        qtyOnHand: item?.qtyOnHand ?? 0,
        shortfall: 0,
        qtyIssued: 0,
        qtyFromStations: 0,
        uncounted: Boolean(item) && item!.qtyOnHand === 0 && !counted.has(line.itemId),
        going: [],
      };
      grouped.set(line.itemId, row);
    }

    const fromDestination = line.fromDestinationId ? byId.get(line.fromDestinationId)?.name ?? 'another station' : undefined;
    if (fromDestination) {
      // Gear moving on from another station is that station's gear twice
      // over: counting it here asks the warehouse for gear it does not need.
      row.qtyFromStations = round2(row.qtyFromStations + line.qtyRequired);
    } else {
      row.qtyRequired = round2(row.qtyRequired + line.qtyRequired);
      row.qtyPacked = round2(row.qtyPacked + line.qtyPacked);
      row.qtyOnTruck = round2(row.qtyOnTruck + (line.qtyOnTruck ?? 0));
      row.qtyIssued = round2(row.qtyIssued + (line.qtyIssued ?? 0));
    }
    row.going.push({
      fromDestination,
      destination,
      qtyRequired: line.qtyRequired,
      qtyPacked: line.qtyPacked,
      qtyOnTruck: line.qtyOnTruck ?? 0,
      packlistId: packlist.id,
      lineId: line.id,
      canPack: !hasIssued(packlist.status) && !fromDestination,
      vehicle: vehicleFor(destination),
    });
  }

  for (const row of grouped.values()) {
    // Uncounted stock is not a shortfall: nobody has looked at the shelf, and
    // reporting a shortage against a number that was never counted sends
    // someone shopping for gear that is probably already in the warehouse.
    // What is already on the truck has left the count, so it is not short:
    // the shelf only has to cover what has not gone yet.
    row.shortfall = row.uncounted ? 0 : round2(Math.max(0, row.qtyRequired - row.qtyIssued - row.qtyOnHand));
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
      (destination) => withPacklists.has(destination.id) && !vehicleFor(destination),
    ),
    vehicles: [...new Set(destinations.map(vehicleFor).filter((name): name is string => Boolean(name)))].sort(
      compareVehicles,
    ),
    destinationsCovered: withPacklists.size,
    packlistsCounted: packlists.length,
  };
}

/** One vehicle's share of the pull list. */
export interface VehicleLoad {
  /** The vehicle's tag, or undefined for gear with no vehicle yet. */
  vehicle: string | undefined;
  /** Total per item for the destinations this vehicle carries. */
  lines: Array<{ item: Item | undefined; itemId: string; qtyRequired: number; qtyPacked: number }>;
  destinations: Destination[];
}

/**
 * The same totals split by vehicle, for loading rather than picking.
 *
 * The undefined vehicle at the end holds anything whose destination has no
 * vehicle yet — gear that has been packed with no way of getting there, which
 * is worth seeing before race morning rather than on it.
 */
export function byVehicle(list: PullList): VehicleLoad[] {
  const groups = new Map<string, VehicleLoad>();
  const key = (vehicle: string | undefined) => vehicle ?? '__none';

  for (const line of list.lines) {
    for (const going of line.going) {
      const id = key(going.vehicle);
      let group = groups.get(id);
      if (!group) {
        group = { vehicle: going.vehicle, lines: [], destinations: [] };
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

  const ordered = [...groups.values()].sort((a, b) => compareVehicles(a.vehicle, b.vehicle));
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

/**
 * True when every share of this item has been ticked off: onto the truck on
 * a two-stage event, packed for its station otherwise.
 */
export function isPulled(line: PullLine, truck = false): boolean {
  return line.qtyRequired > 0 && (truck ? line.qtyOnTruck : line.qtyPacked) >= line.qtyRequired;
}

/**
 * Tick an item off the warehouse list: pack it, or unpack it, on every
 * station's list at once. The warehouse list has no records of its own, so
 * the tick lands on the packlist lines it is totalled from and every station
 * list, progress bar and load step sees it. Lists already loaded are left
 * alone, since stock has left the shed against what they say.
 */
export async function setPulled(shares: PullDestination[], packed: boolean): Promise<LineSnapshot[]> {
  const before: LineSnapshot[] = [];
  for (const share of shares) {
    if (!share.canPack) continue;
    const qty = packed ? share.qtyRequired : 0;
    if (share.qtyPacked === qty) continue;
    before.push({ lineId: share.lineId, qty: share.qtyPacked });
    await update(db.packlistLines, share.lineId, { qtyPacked: qty });
  }
  return before;
}

/** One line's number before a change that touched many, so it can be put back. */
export interface LineSnapshot {
  lineId: string;
  qty: number;
}

/**
 * Put back what a tick across every station changed. One tap on the
 * warehouse list writes to a dozen lists, so a mis-tap needs one tap back,
 * not a dozen stations recounted.
 */
export async function restoreLines(field: 'qtyPacked' | 'qtyOnTruck', before: LineSnapshot[]): Promise<void> {
  for (const { lineId, qty } of before) await update(db.packlistLines, lineId, { [field]: qty });
}
