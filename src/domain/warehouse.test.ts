import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create, liveWhere, update } from '../db/repo';
import { adoptVehiclesFromLoads, byVehicle, isPulled, pullListCsv, pullListFor, setPulled } from './warehouse';
import { recordMovements } from './stock';
import { recordCount, startStocktake } from './stocktake';
import type { Destination, Item, RaceEvent } from '../db/types';

let event: RaceEvent;
let village: Destination;
let aid1: Destination;
let aid3: Destination;
let tables: Item;
let water: Item;
let radios: Item;

async function destination(name: string, courseKm: number | null, sort: number) {
  return create(db.destinations, {
    eventId: event.id, name, type: 'aid_station' as const, courseKm, access: '2wd' as const,
    accessNotes: '', lat: null, lng: null, crewLead: '', phone: '', openTime: '07:00',
    closeTime: '16:00', notes: '', sort,
  });
}

async function item(name: string, sku: string, bin: string, qtyOnHand: number) {
  return create(db.items, {
    name, sku, categoryId: null, unit: 'each' as const, packSize: 1, bin, qtyOnHand,
    minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
  });
}

async function packlist(destination: Destination, lines: Array<[Item, number, number?]>) {
  const list = await create(db.packlists, {
    eventId: event.id, destinationId: destination.id, name: destination.name,
    code: `${destination.name.slice(0, 3).toUpperCase()}-AAAA`, status: 'draft' as const,
    packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
  });
  for (const [entry, qtyRequired, qtyPacked = 0] of lines) {
    await create(db.packlistLines, {
      packlistId: list.id, itemId: entry.id, qtyRequired, qtyPacked, qtyReturned: 0,
      mandatory: false, containerId: null, note: '', sort: 10,
    });
  }
  return list;
}

beforeEach(async () => {
  event = await create(db.events, {
    name: 'Buffalo Stampede', location: 'Bright, VIC', startDate: '2027-09-04',
    endDate: '2027-09-05', status: 'packing', notes: '',
  });
  village = await destination('Event Village', null, 10);
  aid1 = await destination('Aid 1 — Mystic', 8, 20);
  aid3 = await destination('Aid 3 — Plateau', 42, 30);

  tables = await item('Trestle Tables', 'FRN-01', 'Rack C', 40);
  water = await item('Water Containers', 'WAT-01', 'A1', 100);
  radios = await item('Starlink', 'COM-01', 'B2', 0);

  await packlist(village, [[tables, 20, 20], [water, 10]]);
  await packlist(aid1, [[tables, 6], [water, 4], [radios, 1]]);
  await packlist(aid3, [[tables, 4], [water, 8], [radios, 1]]);
});

describe('the warehouse pull list', () => {
  it('totals each item across every packlist for the event', async () => {
    const list = await pullListFor(event.id);

    const byName = (name: string) => list.lines.find((line) => line.item?.name === name)!;
    expect(byName('Trestle Tables').qtyRequired).toBe(30);
    expect(byName('Water Containers').qtyRequired).toBe(22);
    expect(byName('Starlink').qtyRequired).toBe(2);
    expect(list.lines).toHaveLength(3);
  });

  it('says where each share is going, in course order', async () => {
    const list = await pullListFor(event.id);
    const going = list.lines.find((line) => line.item?.name === 'Trestle Tables')!.going;

    // The village has no km, so it sorts after the stations on course order —
    // the breakdown reads the way the race runs.
    expect(going.map((entry) => [entry.destination.name, entry.qtyRequired])).toEqual([
      ['Aid 1 — Mystic', 6],
      ['Aid 3 — Plateau', 4],
      ['Event Village', 20],
    ]);
  });

  it('carries what is already packed through to the total', async () => {
    const list = await pullListFor(event.id);
    const line = list.lines.find((entry) => entry.item?.name === 'Trestle Tables')!;
    expect(line.qtyPacked).toBe(20);
    expect(line.qtyRequired).toBe(30);
  });

  it('flags what the warehouse cannot cover', async () => {
    const list = await pullListFor(event.id);
    const tablesLine = list.lines.find((line) => line.item?.name === 'Trestle Tables')!;
    const waterLine = list.lines.find((line) => line.item?.name === 'Water Containers')!;

    // 30 needed against 40 on hand is fine; 22 against 100 is fine.
    expect(tablesLine.shortfall).toBe(0);
    expect(waterLine.shortfall).toBe(0);

    await recordMovements([{ itemId: tables.id, qty: -25, reason: 'issue' }]);
    const after = await pullListFor(event.id);
    const short = after.lines.find((line) => line.item?.name === 'Trestle Tables')!;
    expect(short.qtyOnHand).toBe(15);
    expect(short.shortfall).toBe(15);
  });

  it('does not call uncounted stock a shortfall', async () => {
    const list = await pullListFor(event.id);
    const starlink = list.lines.find((line) => line.item?.name === 'Starlink')!;

    // Nobody has looked at the shelf. Reporting a shortage against a number
    // that was never counted sends someone shopping for gear already in the shed.
    expect(starlink.uncounted).toBe(true);
    expect(starlink.qtyOnHand).toBe(0);
    expect(starlink.shortfall).toBe(0);
  });

  it('counts a shelf someone walked and found empty', async () => {
    // A zero movement is never written, so counting an empty shelf that the
    // system already believed was empty leaves no trace on the ledger. The
    // stocktake line is the proof that somebody looked.
    const stocktake = await startStocktake('First count', { items: [radios] });
    const [count] = await liveWhere(db.stocktakeCounts, 'stocktakeId', stocktake.id);
    await recordCount(count.id, 0);

    const list = await pullListFor(event.id);
    const starlink = list.lines.find((line) => line.item?.name === 'Starlink')!;
    expect(starlink.uncounted).toBe(false);
    expect(starlink.shortfall).toBe(2);
  });

  it('walks the racks in bin order', async () => {
    const list = await pullListFor(event.id);
    expect(list.lines.map((line) => line.item?.bin)).toEqual(['A1', 'B2', 'Rack C']);
  });

  it('ignores other events entirely', async () => {
    const other = await create(db.events, {
      name: 'Hounslow Classic', location: 'Blue Mountains, NSW', startDate: '2027-10-30',
      endDate: '2027-10-30', status: 'planning', notes: '',
    });
    const elsewhere = await create(db.destinations, {
      eventId: other.id, name: 'Aid 1', type: 'aid_station' as const, courseKm: 5,
      access: '2wd' as const, accessNotes: '', lat: null, lng: null, crewLead: '', phone: '',
      openTime: '07:00', closeTime: '16:00', notes: '', sort: 10,
    });
    const list = await create(db.packlists, {
      eventId: other.id, destinationId: elsewhere.id, name: 'Aid 1', code: 'A1-BBBB',
      status: 'draft' as const, packedBy: '', packedAt: null, deliveredAt: null,
      receivedBy: '', notes: '',
    });
    await create(db.packlistLines, {
      packlistId: list.id, itemId: tables.id, qtyRequired: 999, qtyPacked: 0, qtyReturned: 0,
      mandatory: false, containerId: null, note: '', sort: 10,
    });

    const pull = await pullListFor(event.id);
    expect(pull.lines.find((line) => line.item?.name === 'Trestle Tables')!.qtyRequired).toBe(30);
  });

  it('is empty for an event with no packlists', async () => {
    const bare = await create(db.events, {
      name: 'Wonderland Run', location: 'Halls Gap, VIC', startDate: '2027-02-06',
      endDate: '2027-02-06', status: 'planning', notes: '',
    });
    const list = await pullListFor(bare.id);
    expect(list.lines).toHaveLength(0);
    expect(list.unassigned).toHaveLength(0);
  });
});

describe('splitting the pull list by vehicle', () => {
  it('groups totals under the vehicle tagged on each destination', async () => {
    await update(db.destinations, village.id, { vehicle: 'Hilux' });
    await update(db.destinations, aid1.id, { vehicle: 'Hilux' });

    const groups = byVehicle(await pullListFor(event.id));
    const truck = groups.find((group) => group.vehicle === 'Hilux')!;

    // 20 for the village plus 6 for Aid 1 travel together.
    expect(truck.lines.find((line) => line.item?.name === 'Trestle Tables')!.qtyRequired).toBe(26);
    expect(truck.destinations.map((entry) => entry.name).sort()).toEqual([
      'Aid 1 — Mystic',
      'Event Village',
    ]);
  });

  it('puts gear with no vehicle of its own at the end', async () => {
    await update(db.destinations, village.id, { vehicle: 'Hilux' });

    const list = await pullListFor(event.id);
    // Packed with no way of getting there is worth seeing before race morning.
    expect(list.unassigned.map((entry) => entry.name).sort()).toEqual([
      'Aid 1 — Mystic',
      'Aid 3 — Plateau',
    ]);

    const groups = byVehicle(list);
    expect(groups.at(-1)!.vehicle).toBeUndefined();
    expect(groups.at(-1)!.lines.find((line) => line.item?.name === 'Trestle Tables')!.qtyRequired)
      .toBe(10);
  });

  it('reports one vehicle when nothing has a vehicle yet', async () => {
    const groups = byVehicle(await pullListFor(event.id));
    expect(groups).toHaveLength(1);
    expect(groups[0].vehicle).toBeUndefined();
    expect(groups[0].destinations).toHaveLength(3);
  });

  it('orders vehicles the way people number them', async () => {
    await update(db.destinations, village.id, { vehicle: 'Van 10' });
    await update(db.destinations, aid1.id, { vehicle: 'Van 2' });
    const list = await pullListFor(event.id);
    expect(list.vehicles).toEqual(['Van 2', 'Van 10']);
    expect(byVehicle(list).map((group) => group.vehicle)).toEqual(['Van 2', 'Van 10', undefined]);
  });

  it('still reads a run made before vehicles were tags, and adopts it as a tag once', async () => {
    const hilux = await create(db.loads, {
      eventId: event.id, name: 'Run 1', vehicle: 'Hilux', driver: 'Kate', phone: '',
      status: 'planned' as const, departAt: null, departedAt: null, completedAt: null, notes: '',
    });
    await create(db.loadStops, {
      loadId: hilux.id, destinationId: village.id, sort: 10, arrivedAt: null, signedBy: '', notes: '',
    });
    await update(db.destinations, aid1.id, { vehicle: 'Ute' });

    const before = await pullListFor(event.id);
    expect(before.vehicles).toEqual(['Hilux', 'Ute']);

    expect(await adoptVehiclesFromLoads(event.id)).toBe(1);
    expect((await db.destinations.get(village.id))!.vehicle).toBe('Hilux');
    // The one that already had a tag keeps it.
    expect((await db.destinations.get(aid1.id))!.vehicle).toBe('Ute');
    expect(await adoptVehiclesFromLoads(event.id)).toBe(0);
  });
});

describe('exporting the pull list', () => {
  it('spells the destinations out on one row per item', async () => {
    const csv = pullListCsv(await pullListFor(event.id));
    expect(csv[0]).toEqual([
      'Item', 'SKU', 'Bin', 'Total needed', 'Packed', 'On hand', 'Short by', 'Going to',
    ]);
    const row = csv.find((entry) => entry[0] === 'Trestle Tables')!;
    expect(row[3]).toBe('30');
    expect(row[7]).toBe('Aid 1 — Mystic ×6; Aid 3 — Plateau ×4; Event Village ×20');
  });

  it('writes "not counted" rather than a zero that looks like a count', async () => {
    const csv = pullListCsv(await pullListFor(event.id));
    const row = csv.find((entry) => entry[0] === 'Starlink')!;
    expect(row[5]).toBe('not counted');
    expect(row[6]).toBe('');
  });
});

describe('ticking the warehouse list', () => {
  const water = async () => (await pullListFor(event.id)).lines.find((line) => line.item?.name === 'Water Containers')!;

  it('packs the item on every stop’s list, and unticking unpacks it', async () => {
    await setPulled((await water()).going, true);
    let line = await water();
    expect(isPulled(line)).toBe(true);
    expect(line.going.map((entry) => entry.qtyPacked)).toEqual([4, 8, 10]);

    await setPulled(line.going, false);
    line = await water();
    expect(line.qtyPacked).toBe(0);
  });

  it('ticks one stop on its own', async () => {
    const line = await water();
    await setPulled([line.going[0]], true);
    const after = await water();
    expect(after.going.map((entry) => entry.qtyPacked)).toEqual([4, 0, 0]);
    expect(isPulled(after)).toBe(false);
  });

  it('leaves a list that has already been loaded alone', async () => {
    const list = alive(await db.packlists.toArray()).find((entry) => entry.destinationId === aid3.id)!;
    await update(db.packlists, list.id, { status: 'loaded' });

    const line = await water();
    expect(line.going.find((entry) => entry.destination.id === aid3.id)?.canPack).toBe(false);
    await setPulled(line.going, true);
    expect((await water()).going.map((entry) => entry.qtyPacked)).toEqual([4, 0, 10]);
  });
});
