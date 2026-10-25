import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, liveWhere, update } from '../db/repo';
import { issueLoaded, remainderFor } from './truck';
import { bookReturns, homeListFor, isHome, setHome } from './returns';
import { setStatus } from './packlists';
import type { Destination, Item, PacklistLine, RaceEvent } from '../db/types';

async function makeItem(name: string, consumable = false, qtyOnHand = 100): Promise<Item> {
  return create(db.items, {
    name, sku: name.toUpperCase().slice(0, 6), categoryId: null, unit: 'each', packSize: 1, bin: 'A1',
    qtyOnHand, minQty: 0, barcode: null, notes: '', consumable, archived: false,
  });
}

async function makeEvent(truckStage: boolean): Promise<RaceEvent> {
  return create(db.events, {
    name: 'GPT100 2026', location: 'Halls Gap', startDate: '2026-11-05', endDate: '2026-11-08',
    status: 'packing', notes: '', truckStage,
  });
}

async function makeStation(eventId: string, name: string, sort: number): Promise<Destination> {
  return create(db.destinations, {
    eventId, name, type: 'aid_station', courseKm: sort, access: '2wd', accessNotes: '', lat: null, lng: null,
    crewLead: '', phone: '', openTime: '06:00', closeTime: '16:00', notes: '', sort,
  });
}

async function makeList(destination: Destination) {
  return create(db.packlists, {
    eventId: destination.eventId, destinationId: destination.id, name: destination.name, code: `${destination.name.slice(0, 2).toUpperCase()}-0000`,
    status: 'draft', packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
  });
}

async function makeLine(packlistId: string, itemId: string, partial: Partial<PacklistLine> = {}): Promise<PacklistLine> {
  return create(db.packlistLines, {
    packlistId, itemId, qtyRequired: 4, qtyPacked: 0, qtyReturned: 0, mandatory: false, containerId: null, note: '', sort: 10,
    ...partial,
  });
}

describe('one issue point for both kinds of event', () => {
  it('issues what is on the truck on a truck-then-vans event', async () => {
    const event = await makeEvent(true);
    const table = await makeItem('Trestle Table');
    const list = await makeList(await makeStation(event.id, 'Borough Huts', 10));
    await makeLine(list.id, table.id, { qtyOnTruck: 3, qtyPacked: 1 });
    expect(await issueLoaded(event.id, true, 'Chad')).toEqual({ lines: 1, units: 3, returned: 0 });
    expect((await db.items.get(table.id))!.qtyOnHand).toBe(97);
  });

  it('issues what is packed on a direct event, and only once', async () => {
    const event = await makeEvent(false);
    const table = await makeItem('Trestle Table');
    const list = await makeList(await makeStation(event.id, 'Borough Huts', 10));
    const line = await makeLine(list.id, table.id, { qtyPacked: 3 });
    expect(await issueLoaded(event.id, false, 'Chad')).toEqual({ lines: 1, units: 3, returned: 0 });
    expect(await issueLoaded(event.id, false, 'Chad')).toEqual({ lines: 0, units: 0, returned: 0 });
    // The list marked loaded afterwards takes nothing more.
    await update(db.packlistLines, line.id, { qtyPacked: 5 });
    await setStatus((await db.packlists.get(list.id))!, 'loaded');
    expect((await db.items.get(table.id))!.qtyOnHand).toBe(95);
    expect((await db.events.get(event.id))!.truckLoadedAt).toBeTruthy();
  });
});

describe('the truck remainder', () => {
  it('subtracts the vans from the truck and names the station still waiting', async () => {
    const event = await makeEvent(true);
    const marquee = await makeItem('Marquee');
    const coke = await makeItem('Coke', true);
    const griffin = await makeList(await makeStation(event.id, 'Griffin Fireline', 20));
    const borough = await makeList(await makeStation(event.id, 'Borough Huts', 10));
    await makeLine(griffin.id, marquee.id, { qtyRequired: 2, qtyOnTruck: 2, qtyPacked: 0 });
    await makeLine(borough.id, marquee.id, { qtyRequired: 1, qtyOnTruck: 1, qtyPacked: 1 });
    await makeLine(borough.id, coke.id, { qtyRequired: 48, qtyOnTruck: 48, qtyPacked: 48 });

    const { lines, vans } = await remainderFor(event.id);
    const row = lines.find((line) => line.itemId === marquee.id)!;
    expect(row).toMatchObject({ onTruck: 3, inVans: 1, remaining: 2, spare: 0 });
    expect(row.short.map((share) => share.destination.name)).toEqual(['Griffin Fireline']);
    expect(lines.find((line) => line.itemId === coke.id)).toMatchObject({ remaining: 0 });
    // Things still on the truck come first.
    expect(lines[0].itemId).toBe(marquee.id);
    expect(vans.map((van) => [van.destination.name, van.linesDone, van.linesTotal])).toEqual([
      ['Borough Huts', 2, 2],
      ['Griffin Fireline', 0, 1],
    ]);
  });

  it('reads gear on the truck for nobody as spare', async () => {
    const event = await makeEvent(true);
    const table = await makeItem('Trestle Table');
    const list = await makeList(await makeStation(event.id, 'Borough Huts', 10));
    await makeLine(list.id, table.id, { qtyRequired: 4, qtyOnTruck: 6, qtyPacked: 4 });
    const { lines } = await remainderFor(event.id);
    expect(lines[0]).toMatchObject({ onTruck: 6, inVans: 4, remaining: 2, spare: 2, short: [] });
  });
});

describe('counting it home', () => {
  async function outAndBack() {
    const event = await makeEvent(true);
    const table = await makeItem('Trestle Table');
    const coke = await makeItem('Coke', true, 500);
    const borough = await makeList(await makeStation(event.id, 'Borough Huts', 10));
    const griffin = await makeList(await makeStation(event.id, 'Griffin Fireline', 20));
    const tables1 = await makeLine(borough.id, table.id, { qtyRequired: 4, qtyOnTruck: 4, qtyPacked: 4, qtyReceived: 4, qtyLeft: 4 });
    const tables2 = await makeLine(griffin.id, table.id, { qtyRequired: 2, qtyOnTruck: 2, qtyPacked: 2, qtyReceived: 2 });
    const coke1 = await makeLine(borough.id, coke.id, { qtyRequired: 120, qtyOnTruck: 120, qtyPacked: 120, qtyReceived: 120, qtyLeft: 14 });
    const coke2 = await makeLine(griffin.id, coke.id, { qtyRequired: 120, qtyOnTruck: 120, qtyPacked: 120, qtyReceived: 120 });
    await issueLoaded(event.id, true);
    return { event, table, coke, borough, griffin, tables1, tables2, coke1, coke2 };
  }

  it('expects what the station counted, what arrived for gear, and nothing for uncounted food', async () => {
    const { event, table, coke } = await outAndBack();
    const list = await homeListFor(event.id);
    const tables = list.lines.find((line) => line.itemId === table.id)!;
    const cokes = list.lines.find((line) => line.itemId === coke.id)!;
    expect(tables).toMatchObject({ sent: 6, expected: 6, counted: 0, gap: -6 });
    expect(cokes).toMatchObject({ sent: 240, expected: 14, counted: 0, gap: -14 });
    expect(cokes.going.map((share) => share.stationCounted)).toEqual([true, false]);
    expect(list.stations).toBe(2);
  });

  it('ticks an item home at what was expected and books it once', async () => {
    const { event, table, coke, tables1 } = await outAndBack();
    let list = await homeListFor(event.id);
    const tables = list.lines.find((line) => line.itemId === table.id)!;
    expect(await setHome(tables.going, true)).toBe(2);
    list = await homeListFor(event.id);
    expect(isHome(list.lines.find((line) => line.itemId === table.id)!)).toBe(true);

    expect(await bookReturns(event.id, 'Chad')).toEqual({ lines: 2, units: 6 });
    expect((await db.items.get(table.id))!.qtyOnHand).toBe(100);
    expect((await db.items.get(coke.id))!.qtyOnHand).toBe(260);
    // Pressing it again books nothing. Counting one more than went out books
    // nothing either: the warehouse never let that one go, so it is flagged
    // for a stocktake rather than made out of nothing.
    expect(await bookReturns(event.id)).toEqual({ lines: 0, units: 0 });
    await update(db.packlistLines, tables1.id, { qtyReturned: 5 });
    expect(await bookReturns(event.id)).toEqual({ lines: 1, units: 0 });
    expect((await db.items.get(table.id))!.qtyOnHand).toBe(100);
    list = await homeListFor(event.id);
    expect(list.lines.find((line) => line.itemId === table.id)!.overIssued).toBe(1);
    expect((await db.events.get(event.id))!.truckUnloadedAt).toBeTruthy();
  });

  it('does not book twice when a list is also reconciled the old way', async () => {
    const { event, table, borough } = await outAndBack();
    const list = await homeListFor(event.id);
    await setHome(list.lines.find((line) => line.itemId === table.id)!.going, true);
    await bookReturns(event.id);
    await setStatus((await db.packlists.get(borough.id))!, 'reconciled');
    expect((await db.items.get(table.id))!.qtyOnHand).toBe(100);
    const lines = await liveWhere(db.packlistLines, 'packlistId', borough.id);
    expect(lines.find((line) => line.itemId === table.id)!.qtyBooked).toBe(4);
  });
});

describe('the count adds up across truck, vans, stations and home', () => {
  const onHand = async (item: Item) => (await db.items.get(item.id))!.qtyOnHand;

  it('expects gear that rode the truck but never reached a van back with the truck', async () => {
    const event = await makeEvent(true);
    const table = await makeItem('Trestle Table', false, 70);
    const gar = await makeList(await makeStation(event.id, 'GAR Trailhead', 10));
    const zero = await makeList(await makeStation(event.id, 'Mt Zero', 0));
    await makeLine(gar.id, table.id, { qtyRequired: 40, qtyOnTruck: 40 });
    await makeLine(zero.id, table.id, { qtyRequired: 23, qtyOnTruck: 23, qtyPacked: 23 });
    await issueLoaded(event.id, true);
    expect(await onHand(table)).toBe(7);

    const [line] = (await homeListFor(event.id)).lines;
    expect(line.expected).toBe(63);
    await setHome(line.going, true);
    await bookReturns(event.id);
    expect(await onHand(table)).toBe(70);
  });

  it('never books home gear that never left the warehouse', async () => {
    const event = await makeEvent(true);
    const table = await makeItem('Trestle Table', false, 70);
    const list = await makeList(await makeStation(event.id, 'GAR Trailhead', 10));
    // Ticked into the van at the yard, but nothing went on the truck.
    await makeLine(list.id, table.id, { qtyRequired: 15, qtyPacked: 15 });
    const [line] = (await homeListFor(event.id)).lines;
    await setHome(line.going, true);
    await bookReturns(event.id);
    expect(await onHand(table)).toBe(70);
    expect((await homeListFor(event.id)).lines[0].overIssued).toBe(15);
  });

  it('takes stock back off the shelf when a booked home count is lowered', async () => {
    const event = await makeEvent(false);
    const esky = await makeItem('Esky', false, 5);
    const list = await makeList(await makeStation(event.id, 'Rosea', 10));
    const line = await makeLine(list.id, esky.id, { qtyRequired: 5, qtyPacked: 5 });
    await issueLoaded(event.id, false);
    await update(db.packlistLines, line.id, { qtyReturned: 5 });
    await bookReturns(event.id);
    expect(await onHand(esky)).toBe(5);
    await update(db.packlistLines, line.id, { qtyReturned: 3 });
    await bookReturns(event.id);
    expect(await onHand(esky)).toBe(3);
  });

  it('puts gear taken off the truck before it left back on the count', async () => {
    const event = await makeEvent(true);
    const marquee = await makeItem('Marquee', false, 50);
    const list = await makeList(await makeStation(event.id, 'Borough Huts', 10));
    const line = await makeLine(list.id, marquee.id, { qtyRequired: 43, qtyOnTruck: 43 });
    await issueLoaded(event.id, true);
    expect(await onHand(marquee)).toBe(7);
    // Off again to make room for the Beechworth pallet.
    await update(db.packlistLines, line.id, { qtyOnTruck: 0 });
    expect(await issueLoaded(event.id, true)).toMatchObject({ lines: 0, returned: 43 });
    expect(await onHand(marquee)).toBe(50);
    expect((await db.events.get(event.id))!.truckRuns).toHaveLength(2);
  });

  it('takes stock out once however many times loaded is pressed at once', async () => {
    const event = await makeEvent(true);
    const starlink = await makeItem('Starlink', false, 5);
    const list = await makeList(await makeStation(event.id, 'Mt William', 10));
    await makeLine(list.id, starlink.id, { qtyRequired: 3, qtyOnTruck: 3 });
    await Promise.all([issueLoaded(event.id, true), issueLoaded(event.id, true), issueLoaded(event.id, true)]);
    expect(await onHand(starlink)).toBe(2);
  });

  it('counts gear moved on from another station once, out and home', async () => {
    const event = await makeEvent(false);
    const marquee = await makeItem('Marquee', false, 10);
    const north = await makeStation(event.id, 'Mt Zero', 0);
    const south = await makeStation(event.id, 'Jimmy Creek Campground', 100);
    const northList = await makeList(north);
    const southList = await makeList(south);
    await makeLine(northList.id, marquee.id, { qtyRequired: 4, qtyPacked: 4 });
    // The same four marquees, packed down at Mt Zero and rebuilt at Jimmy Creek.
    await makeLine(southList.id, marquee.id, { qtyRequired: 4, fromDestinationId: north.id });

    const { pullListFor } = await import('./warehouse');
    const [pull] = (await pullListFor(event.id)).lines;
    expect(pull.qtyRequired).toBe(4);
    expect(pull.qtyFromStations).toBe(4);

    await issueLoaded(event.id, false);
    expect(await onHand(marquee)).toBe(6);

    const [home] = (await homeListFor(event.id)).lines;
    expect(home.expected).toBe(4);
    expect(home.going.find((share) => share.destination.id === north.id)!.expected).toBe(0);
    await setHome(home.going, true);
    await bookReturns(event.id);
    expect(await onHand(marquee)).toBe(10);
  });
});
