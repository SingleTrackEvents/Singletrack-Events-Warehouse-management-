import type { Destination, Packlist, PacklistLine } from '../db/types';
import { yardOrder } from './truck';

/**
 * What a printed sheet says about each item.
 *
 * The paper used to print what the station should expect, which read the
 * same whether the warehouse packed the item or not. A loader holding that
 * sheet believed gear was on the van that never went in. The sheet now
 * prints what was actually packed, and says MISSING in so many words when
 * an item is short, so nobody has to work it out from two numbers.
 */

export interface SheetLine {
  line: PacklistLine;
  /** What the station needs. */
  needed: number;
  /**
   * What went in. On a truck-stage event this is the van pack, which is the
   * same field: the truck has its own count and the van is what the station
   * gets.
   */
  packed: number;
  /** Short by this many; 0 when the item is fully packed. */
  missing: number;
  /** Fully packed, so the box prints ticked. */
  done: boolean;
  /** Set when the item comes from another station, not the warehouse. */
  fromStationId: string | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function sheetLine(line: PacklistLine): SheetLine {
  const needed = line.qtyRequired;
  const packed = line.qtyPacked;
  // Gear moving on from another station is not packed here at all, so it is
  // never missing from this van. The sheet says where it comes from instead.
  if (line.fromDestinationId) {
    return { line, needed, packed, missing: 0, done: false, fromStationId: line.fromDestinationId };
  }
  const missing = round2(Math.max(0, needed - packed));
  return { line, needed, packed, missing, done: missing === 0, fromStationId: null };
}

export interface SheetSummary {
  /** Items the warehouse packs for this station. */
  total: number;
  packed: number;
  /** Names of the items packed short or not at all, in sheet order. */
  missing: string[];
  /** Items coming from another station, counted apart. */
  fromOtherStations: number;
}

export function sheetSummary(lines: SheetLine[], nameOf: (line: PacklistLine) => string): SheetSummary {
  const own = lines.filter((entry) => !entry.fromStationId);
  return {
    total: own.length,
    packed: own.filter((entry) => entry.done).length,
    missing: own.filter((entry) => !entry.done).map((entry) => nameOf(entry.line)),
    fromOtherStations: lines.length - own.length,
  };
}

/** How many missing names a summary lists before it says "and n more". */
const NAMES_SHOWN = 8;

/** The one line at the top of a sheet: "21 of 23 items packed, 2 missing: Esky, Ice". */
export function summaryText(summary: SheetSummary): string {
  const { total, packed, missing } = summary;
  if (!total) return 'No items for the warehouse to pack.';
  const noun = total === 1 ? 'item' : 'items';
  if (!missing.length) return total === 1 ? 'The one item is packed.' : `All ${total} items packed.`;
  // Each name once: two stations on one van both short of marquee walls is
  // one thing to find, not two names in the list.
  const names = [...new Set(missing)];
  const named = names.slice(0, NAMES_SHOWN).join(', ');
  const more = names.length > NAMES_SHOWN ? ` and ${names.length - NAMES_SHOWN} more` : '';
  return `${packed} of ${total} ${noun} packed, ${missing.length} missing: ${named}${more}.`;
}

/** One station on a vehicle's sheet. */
export interface VanStation {
  destination: Destination;
  packlist: Packlist | undefined;
}

/** One vehicle and the stations it serves, in the order they leave the yard. */
export interface VanGroup {
  /** The vehicle tag as typed, or null for stations with no vehicle yet. */
  vehicle: string | null;
  stations: VanStation[];
}

/**
 * Stations grouped by the vehicle that carries them.
 *
 * The tag is free text, so "Van 3" and "van 3 " are the same van. Vehicles
 * come in the order their first station leaves the yard; stations with no
 * vehicle come last, since nobody can load them until somebody picks one.
 */
export function vanGroups(destinations: Destination[], packlistOf: (destination: Destination) => Packlist | undefined): VanGroup[] {
  const ordered = [...destinations]
    .filter((destination) => !destination.deletedAt)
    .map((destination) => ({ destination }))
    .sort(yardOrder)
    .map(({ destination }) => destination);

  const groups = new Map<string, VanGroup>();
  const unassigned: VanGroup = { vehicle: null, stations: [] };
  for (const destination of ordered) {
    const tag = destination.vehicle?.trim() ?? '';
    const station = { destination, packlist: packlistOf(destination) };
    if (!tag) {
      unassigned.stations.push(station);
      continue;
    }
    const key = tag.toLowerCase().replace(/\s+/g, ' ');
    let group = groups.get(key);
    if (!group) {
      group = { vehicle: tag, stations: [] };
      groups.set(key, group);
    }
    group.stations.push(station);
  }
  return unassigned.stations.length ? [...groups.values(), unassigned] : [...groups.values()];
}
