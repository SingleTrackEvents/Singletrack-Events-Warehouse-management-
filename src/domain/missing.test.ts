import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create, update } from '../db/repo';
import { addPlanItems } from './consumption';
import { buyEverything, eventShortfallsFor, notPackedByStation, wantsFor, whatsMissing } from './missing';
import { addShoppingLine, inputForItem, markBought } from './shopping';
import type { Destination, Item, Packlist, PacklistLine, RaceEvent } from '../db/types';

let event: RaceEvent;
let aid1: Destination;
let aid3: Destination;
let village: Destination;
let tables: Item;
let radios: Item;
let flags: Item;
let coke: Item;

async function destination(name: string, courseKm: number | null, sort: number, raceVisits = [] as Destination['raceVisits']) {
  return create(db.destinations, {
    eventId: event.id, name, type: 'aid_station' as const, courseKm, access: '2wd' as const,
    accessNotes: '', lat: null, lng: null, crewLead: '', phone: '', openTime: '07:00',
    closeTime: '16:00', notes: '', sort, raceVisits,
  });
}

async function item(name: string, qtyOnHand: number, sku = name.toUpperCase()) {
  return create(db.items, {
    name, sku, categoryId: null, unit: 'each' as const, packSize: 1, bin: 'A1', qtyOnHand,
    minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
  });
}

async function packlist(
  where: Destination,
  lines: Array<[Item, number, number, Partial<PacklistLine>?]>,
): Promise<Packlist> {
  const list = await create(db.packlists, {
    eventId: event.id, destinationId: where.id, name: where.name,
    code: `${where.name.slice(0, 3).toUpperCase()}-AAAA`, status: 'draft' as const,
    packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
  });
  for (const [entry, qtyRequired, qtyPacked, extra] of lines) {
    await create(db.packlistLines, {
      packlistId: list.id, itemId: entry.id, qtyRequired, qtyPacked, qtyReturned: 0,
      mandatory: false, containerId: null, note: '', sort: 10, ...extra,
    });
  }
  return list;
}

beforeEach(async () => {
  event = await create(db.events, {
    name: 'Buffalo Stampede', location: 'Bright, VIC', startDate: '2027-04-10',
    endDate: '2027-04-11', status: 'packing', notes: '',
  });
  const race = await create(db.races, { eventId: event.id, name: 'Marathon', projection: 100, sort: 10, day: null });
  village = await destination('Event Village', null, 10);
  aid3 = await destination('Aid 3 Plateau', 42, 30, [{ raceId: race.id, passes: 1 }]);
  aid1 = await destination('Aid 1 Mystic', 8, 20, [{ raceId: race.id, passes: 1 }]);

  tables = await item('Trestle Tables', 2);
  radios = await item('Radios', 10);
  // Nothing on the shelf and never counted: nobody knows how many there are.
  flags = await item('Course Flags', 0);
  coke = await item('Coke', 4, 'FD-05');

  await packlist(aid1, [[tables, 3, 1], [radios, 2, 2], [flags, 50, 0]]);
  // Two tables moving on from Aid 1 are Aid 1's to hand over, not Aid 3's to pack.
  await packlist(aid3, [[tables, 2, 2], [radios, 4, 1], [tables, 2, 0, { fromDestinationId: aid1.id }]]);
  await addPlanItems(event.id, aid1.id, [{ itemId: coke.id, perRunner: 0.2 }]);
});

describe('not packed yet', () => {
  it('lists each station’s items still short, in course order', async () => {
    const missing = await whatsMissing(event.id);
    expect(missing.notPacked.map((station) => station.destination.name)).toEqual(['Aid 1 Mystic', 'Aid 3 Plateau']);

    const [first, second] = missing.notPacked;
    expect(first.items.map((entry) => [entry.item?.name, entry.short])).toEqual([
      ['Course Flags', 50],
      ['Trestle Tables', 2],
    ]);
    // Radios at Aid 1 are packed; the tables moving on from Aid 1 are left out.
    expect(second.items.map((entry) => [entry.item?.name, entry.short])).toEqual([['Radios', 3]]);
  });

  it('says which stations have no packing list yet', async () => {
    const missing = await whatsMissing(event.id);
    expect(missing.noList.map((station) => station.id)).toEqual([village.id]);
    expect(missing.stations).toBe(3);
  });

  it('counts what is on the truck on a two-stage event, as the warehouse list does', () => {
    const list = { id: 'p1', destinationId: aid1.id, deletedAt: null } as Packlist;
    const line = {
      id: 'l1', packlistId: 'p1', itemId: tables.id, qtyRequired: 3, qtyPacked: 0, qtyOnTruck: 3, deletedAt: null,
    } as PacklistLine;
    expect(notPackedByStation([aid1], [list], [line], [tables], true)).toEqual([]);
    expect(notPackedByStation([aid1], [list], [line], [tables], false)[0].items[0].short).toBe(3);
  });
});

describe('not enough in the warehouse', () => {
  it('reports the event shortfall against what is on the shelf', async () => {
    const missing = await whatsMissing(event.id);
    // 5 tables needed from the warehouse (the 2 moving on are not), 2 on the shelf.
    expect(missing.warehouseShort.map((line) => [line.item?.name, line.shortfall])).toEqual([['Trestle Tables', 3]]);
  });

  it('lists never-counted stock as unknown, never as covered or short', async () => {
    const missing = await whatsMissing(event.id);
    expect(missing.uncounted.map((line) => line.item?.name)).toEqual(['Course Flags']);
    expect(missing.warehouseShort.some((line) => line.itemId === flags.id)).toBe(false);
  });

  it('leaves food in the plan to the food section, even when it is on a packing list', async () => {
    await packlist(village, [[coke, 30, 0]]);
    const missing = await whatsMissing(event.id);
    expect(missing.warehouseShort.some((line) => line.itemId === coke.id)).toBe(false);
    expect(missing.food.map((total) => [total.item.name, total.toOrder])).toEqual([['Coke', 16]]);
  });
});

describe('putting everything on the shopping list', () => {
  it('adds the gear and food shortfalls for the event, not the uncounted stock', async () => {
    const result = await buyEverything(event.id, 'Sam');
    expect(result.added).toBe(2);
    const lines = alive(await db.shoppingLines.toArray());
    expect(lines.map((line) => [line.name, line.qty, line.source, line.eventId]).sort()).toEqual([
      ['Coke', 16, 'food_plan', event.id],
      ['Trestle Tables', 3, 'packlist', event.id],
    ]);
  });

  it('is safe to tap twice', async () => {
    await buyEverything(event.id);
    const again = await buyEverything(event.id);
    expect(again).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(alive(await db.shoppingLines.toArray())).toHaveLength(2);
  });

  it('does not send someone back for what was bought and is waiting to be booked in', async () => {
    await buyEverything(event.id);
    const tablesLine = alive(await db.shoppingLines.toArray()).find((line) => line.itemId === tables.id)!;
    await markBought(tablesLine.id);
    const again = await buyEverything(event.id);
    expect(again.added).toBe(0);
    expect(alive(await db.shoppingLines.toArray()).filter((line) => line.itemId === tables.id)).toHaveLength(1);
  });

  it('works out the same wants the screen shows', async () => {
    const wants = wantsFor(await whatsMissing(event.id));
    expect(wants.map((want) => [want.item.name, want.qty])).toEqual([
      ['Trestle Tables', 3],
      ['Coke', 16],
    ]);
  });
});

describe('eventShortfallsFor', () => {
  it('finds the upcoming events short of an item, soonest first', async () => {
    const later = await create(db.events, {
      name: 'Wonderland', location: 'Halls Gap', startDate: '2027-06-01', endDate: '2027-06-01',
      status: 'planning', notes: '',
    });
    const station = await create(db.destinations, { ...aid1, id: 'w-aid', eventId: later.id });
    const list = await create(db.packlists, {
      eventId: later.id, destinationId: station.id, name: 'W', code: 'W-1', status: 'draft' as const,
      packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
    });
    await create(db.packlistLines, {
      packlistId: list.id, itemId: tables.id, qtyRequired: 10, qtyPacked: 0, qtyReturned: 0,
      mandatory: false, containerId: null, note: '', sort: 10,
    });

    const found = await eventShortfallsFor(tables.id, '2027-01-01');
    expect(found.map((entry) => [entry.event.name, entry.qty])).toEqual([
      ['Buffalo Stampede', 3],
      ['Wonderland', 8],
    ]);
  });

  it('skips events that are over or closed', async () => {
    expect(await eventShortfallsFor(tables.id, '2027-05-01')).toEqual([]);
    await update(db.events, event.id, { status: 'closed' });
    expect(await eventShortfallsFor(tables.id, '2027-01-01')).toEqual([]);
  });

  it('takes off what is already on the list for that event', async () => {
    await addShoppingLine(inputForItem(tables, 2, { eventId: event.id, source: 'packlist' }));
    const [found] = await eventShortfallsFor(tables.id, '2027-01-01');
    expect(found.qty).toBe(1);
  });
});
