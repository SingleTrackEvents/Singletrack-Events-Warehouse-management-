import { db } from '../db/db';
import { alive, liveWhere } from '../db/repo';
import type { Destination, Item, Packlist, PacklistLine, RaceEvent } from '../db/types';
import { loadFoodPlan, totalsToOrder } from './consumption';
import type { FoodTotal } from './consumption';
import { localIsoDate } from './format';
import { addEventShortfalls } from './shopping';
import type { EventWant, FeedResult } from './shopping';
import { round2 } from './stock';
import { pullListFor } from './warehouse';
import type { PullLine } from './warehouse';

/**
 * What an event still needs, in one place.
 *
 * Three questions the crew used to answer from three screens: which stations
 * are not packed yet, what the warehouse does not have enough of, and what
 * food has to be bought. Nothing here is stored. It is worked out from the
 * packing lists, the warehouse list and the food plan every time, so it is
 * right the moment any of them changes.
 */

/** One item a station is still short of. */
export interface ShortItem {
  lineId: string;
  itemId: string;
  item: Item | undefined;
  needed: number;
  done: number;
  /** needed minus done, never below zero. */
  short: number;
}

/** A station with items still to pack, and the list to fix it on. */
export interface StationShort {
  destination: Destination;
  packlist: Packlist;
  items: ShortItem[];
}

export interface WhatsMissing {
  /** Two-stage event: "packed" means on the truck, as on the warehouse list. */
  truck: boolean;
  /** How many stations the event has, so an empty event can say so. */
  stations: number;
  notPacked: StationShort[];
  /** Stations with no packing list at all, so nothing can be short on them yet. */
  noList: Destination[];
  /** Gear the warehouse holds fewer of than the event needs. */
  warehouseShort: PullLine[];
  /** Gear whose shelf has never been counted, so nobody knows if it is short. */
  uncounted: PullLine[];
  /** Food and drink the plan says to buy. */
  food: FoodTotal[];
}

/** Course order, the way the race runs and the way the crew read stations. */
function byCourse(a: Destination, b: Destination): number {
  return (
    (a.courseKm ?? Number.MAX_SAFE_INTEGER) - (b.courseKm ?? Number.MAX_SAFE_INTEGER) ||
    a.sort - b.sort ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Every station's items still short of what the station needs.
 *
 * Gear coming from another station is left out: it is that station's to
 * hand over, not something to pack here, and the warehouse list leaves it
 * out for the same reason. On a two-stage event the warehouse's job is
 * getting gear onto the truck, so that is what counts as done, the same as
 * the warehouse list.
 */
export function notPackedByStation(
  destinations: Destination[],
  packlists: Packlist[],
  lines: PacklistLine[],
  items: Item[],
  truck: boolean,
): StationShort[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const packlistByDestination = new Map<string, Packlist>();
  for (const packlist of alive(packlists)) {
    if (!packlistByDestination.has(packlist.destinationId)) packlistByDestination.set(packlist.destinationId, packlist);
  }
  const out: StationShort[] = [];
  for (const destination of alive(destinations).sort(byCourse)) {
    const packlist = packlistByDestination.get(destination.id);
    if (!packlist) continue;
    const short: ShortItem[] = [];
    for (const line of alive(lines)) {
      if (line.packlistId !== packlist.id || line.fromDestinationId) continue;
      const done = truck ? (line.qtyOnTruck ?? 0) : line.qtyPacked;
      if (line.qtyRequired <= 0 || done >= line.qtyRequired) continue;
      short.push({
        lineId: line.id,
        itemId: line.itemId,
        item: itemById.get(line.itemId),
        needed: line.qtyRequired,
        done,
        short: round2(line.qtyRequired - done),
      });
    }
    if (!short.length) continue;
    short.sort((a, b) => (a.item?.name ?? '').localeCompare(b.item?.name ?? ''));
    out.push({ destination, packlist, items: short });
  }
  return out;
}

/** Everything the event still needs, read in one go. */
export async function whatsMissing(eventId: string): Promise<WhatsMissing> {
  const event = await db.events.get(eventId);
  const truck = Boolean(event?.truckStage);
  const [destinations, packlists, items, pull, plan] = await Promise.all([
    liveWhere(db.destinations, 'eventId', eventId),
    liveWhere(db.packlists, 'eventId', eventId),
    db.items.toArray().then(alive),
    pullListFor(eventId),
    loadFoodPlan(eventId),
  ]);
  const packlistIds = new Set(packlists.map((packlist) => packlist.id));
  const lines = alive(await db.packlistLines.toArray()).filter((line) => packlistIds.has(line.packlistId));

  const totals = totalsToOrder(plan.lines, destinations, plan.races, items);
  const food = totals.filter((total) => total.toOrder > 0);
  // Food in the plan is shown and bought under food, where its figure comes
  // from. Showing it again under the warehouse would put it in front of the
  // crew twice, and buying it twice.
  const planned = new Set(totals.map((total) => total.item.id));
  const gear = pull.lines.filter((line) => !planned.has(line.itemId) && line.qtyRequired > 0);

  const withList = new Set(packlists.map((packlist) => packlist.destinationId));
  return {
    truck,
    stations: destinations.length,
    notPacked: notPackedByStation(destinations, packlists, lines, items, truck),
    noList: destinations.filter((destination) => !withList.has(destination.id)).sort(byCourse),
    warehouseShort: gear.filter((line) => line.shortfall > 0),
    uncounted: gear.filter((line) => line.uncounted && line.item),
    food,
  };
}

/**
 * Everything to buy for the event: the gear shortfall against what the event
 * needs (not the reorder point, which is about the warehouse, not this race),
 * and the food plan's shortfall. Gear whose stock was never counted is left
 * off, since buying it would be guessing.
 */
export function wantsFor(missing: WhatsMissing): EventWant[] {
  const wants: EventWant[] = [];
  for (const line of missing.warehouseShort) {
    if (line.item) wants.push({ item: line.item, qty: line.shortfall, source: 'packlist' });
  }
  for (const total of missing.food) wants.push({ item: total.item, qty: total.toOrder, source: 'food_plan' });
  return wants;
}

/** Put everything the event is short of on the shopping list. Safe to tap twice. */
export async function buyEverything(eventId: string, by = ''): Promise<FeedResult> {
  return addEventShortfalls(eventId, wantsFor(await whatsMissing(eventId)), by);
}

/** One upcoming event that is short of an item, and by how much. */
export interface EventShortfall {
  event: RaceEvent;
  qty: number;
}

/**
 * The upcoming events that are short of one item, soonest first.
 *
 * Used where someone is about to buy the item: if Buffalo is three short,
 * three is the number to buy for Buffalo, whatever the reorder point says.
 * What is already on the shopping list for that event, or bought and not
 * booked in yet, is taken off, so the figure is what still has to go on the
 * list. Events that are over, or closed, are not asked.
 */
export async function eventShortfallsFor(itemId: string, today = localIsoDate()): Promise<EventShortfall[]> {
  const events = alive(await db.events.toArray())
    .filter((event) => event.status !== 'closed' && (event.endDate || event.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const listed = alive(await db.shoppingLines.where('itemId').equals(itemId).toArray()).filter(
    (line) => !line.bookedAt,
  );
  const out: EventShortfall[] = [];
  for (const event of events) {
    const want = wantsFor(await whatsMissing(event.id)).find((entry) => entry.item.id === itemId);
    if (!want) continue;
    const already = listed
      .filter((line) => line.eventId === event.id)
      .reduce((sum, line) => sum + line.qty, 0);
    const qty = round2(want.qty - already);
    if (qty > 0) out.push({ event, qty });
  }
  return out;
}
