import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, liveWhere } from '../db/repo';
import { setStatus } from './packlists';
import { loadTruck, moveInVan, setOnTruck, unloadOrder } from './truck';
import { pullListFor } from './warehouse';
import type { Category, Destination, Item, Packlist, PacklistLine, RaceEvent } from '../db/types';

let event: RaceEvent;
let station: Destination;
let list: Packlist;
let shelter: Category;
let food: Category;
let marquee: Item;
let lollies: Item;
let tables: Item;

async function item(name: string, categoryId: string, qtyOnHand: number) {
  return create(db.items, {
    name, sku: name.slice(0, 6).toUpperCase(), categoryId, unit: 'each' as const, packSize: 1, bin: '',
    qtyOnHand, minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
  });
}

async function line(entry: Item, qtyRequired: number, sort: number) {
  return create(db.packlistLines, {
    packlistId: list.id, itemId: entry.id, qtyRequired, qtyPacked: 0, qtyReturned: 0,
    mandatory: false, containerId: null, note: '', sort,
  });
}

beforeEach(async () => {
  event = await create(db.events, {
    name: 'Roller Coaster Run', location: 'Kalorama', startDate: '2026-10-17', endDate: '2026-10-17',
    status: 'packing', notes: '', truckStage: true,
  });
  station = await create(db.destinations, {
    eventId: event.id, name: 'Doongalla', type: 'aid_station' as const, courseKm: null, access: '2wd' as const,
    accessNotes: '', lat: null, lng: null, crewLead: '', phone: '', openTime: '07:00', closeTime: '16:00',
    notes: '', sort: 10,
  });
  list = await create(db.packlists, {
    eventId: event.id, destinationId: station.id, name: 'Doongalla', code: 'DPG-AAAA', status: 'draft' as const,
    packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
  });
  shelter = await create(db.categories, { name: 'Structure & Shelter', sort: 10, icon: '⛺' });
  food = await create(db.categories, { name: 'Aid Station Food & Drink', sort: 20, icon: '🍌' });
  const furniture = await create(db.categories, { name: 'Furniture & Site Equipment', sort: 30, icon: '🪑' });
  marquee = await item('Marquee', shelter.id, 20);
  lollies = await item('Lollies', food.id, 30);
  tables = await item('Trestle', furniture.id, 40);
});

const shares = async (entry: Item) =>
  (await pullListFor(event.id)).lines.find((pull) => pull.itemId === entry.id)!.going;

describe('the truck', () => {
  it('ticks gear onto the truck without packing the station', async () => {
    await line(marquee, 3, 10);
    await setOnTruck(await shares(marquee), true);

    const [only] = await liveWhere(db.packlistLines, 'packlistId', list.id);
    expect(only.qtyOnTruck).toBe(3);
    expect(only.qtyPacked).toBe(0);
  });

  it('takes stock out when loaded, and the van pack does not take it again', async () => {
    await line(marquee, 3, 10);
    await setOnTruck(await shares(marquee), true);

    await loadTruck(event.id);
    expect((await db.items.get(marquee.id))?.qtyOnHand).toBe(17);
    expect((await db.events.get(event.id))?.truckLoadedAt).toBeTruthy();

    // At the event the van is packed and loaded: no second issue.
    const [packed] = await liveWhere(db.packlistLines, 'packlistId', list.id);
    await db.packlistLines.update(packed.id, { qtyPacked: 3 });
    await setStatus((await db.packlists.get(list.id))!, 'loaded');
    expect((await db.items.get(marquee.id))?.qtyOnHand).toBe(17);
  });

  it('loaded again only takes out what was added since', async () => {
    const first = await line(marquee, 3, 10);
    await setOnTruck(await shares(marquee), true);
    await loadTruck(event.id);
    await db.packlistLines.update(first.id, { qtyRequired: 5, qtyOnTruck: 5 });

    const { units } = await loadTruck(event.id);
    expect(units).toBe(2);
    expect((await db.items.get(marquee.id))?.qtyOnHand).toBe(15);
  });

  it('a one-stage event still issues when its list is loaded', async () => {
    const only = await line(tables, 4, 10);
    await db.packlistLines.update(only.id, { qtyPacked: 4 });
    await setStatus((await db.packlists.get(list.id))!, 'loaded');
    expect((await db.items.get(tables.id))?.qtyOnHand).toBe(36);
  });
});

describe('van order', () => {
  const categoryOf = (lines: Map<string, Category>) => (entry: PacklistLine) => lines.get(entry.itemId);

  it('unloads in setup order: shelter, then furniture, food last', async () => {
    await line(lollies, 2, 10);
    await line(tables, 4, 20);
    await line(marquee, 3, 30);
    const cats = new Map([[lollies.id, food], [marquee.id, shelter], [tables.id, (await db.categories.get(tables.categoryId!))!]]);

    const order = unloadOrder(await liveWhere(db.packlistLines, 'packlistId', list.id), categoryOf(cats));
    expect(order.map((entry) => entry.itemId)).toEqual([marquee.id, tables.id, lollies.id]);
  });

  it('moves a line without reshuffling the rest', async () => {
    await line(lollies, 2, 10);
    await line(tables, 4, 20);
    await line(marquee, 3, 30);
    const cats = new Map([[lollies.id, food], [marquee.id, shelter], [tables.id, (await db.categories.get(tables.categoryId!))!]]);
    const read = async () => unloadOrder(await liveWhere(db.packlistLines, 'packlistId', list.id), categoryOf(cats));

    const lolliesLine = (await read()).find((entry) => entry.itemId === lollies.id)!;
    await moveInVan(await read(), lolliesLine.id, -1);

    expect((await read()).map((entry) => entry.itemId)).toEqual([marquee.id, lollies.id, tables.id]);
  });
});
