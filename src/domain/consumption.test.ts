import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create, liveWhere, softDelete } from '../db/repo';
import {
  addPlanItems,
  applyPlanToPacklists,
  copyRuleForRace,
  eventDays,
  lineQty,
  lineQtyByDay,
  lineTotal,
  loadFoodPlan,
  stationRunners,
  stationRunnersByDay,
  totalsToOrder,
} from './consumption';
import { addLine, createPacklist } from './packlists';
import type { ConsumptionLine, Destination, Item, Race, RaceVisit } from '../db/types';

async function makeEvent() {
  return create(db.events, {
    name: 'Hounslow Classic',
    location: 'Blackheath',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    status: 'planning',
    notes: '',
  });
}

async function makeDestination(eventId: string, raceVisits?: RaceVisit[]): Promise<Destination> {
  return create(db.destinations, {
    eventId,
    name: 'Grand Canyon Carpark',
    type: 'aid_station',
    courseKm: null,
    access: '2wd',
    accessNotes: '',
    lat: null,
    lng: null,
    crewLead: '',
    phone: '',
    openTime: '07:00',
    closeTime: '16:00',
    notes: '',
    sort: 10,
    ...(raceVisits ? { raceVisits } : {}),
  });
}

async function makeRace(
  eventId: string,
  name: string,
  projection: number,
  day: string | null = null,
): Promise<Race> {
  return create(db.races, { eventId, name, projection, sort: 10, day });
}

async function makeItem(sku: string, qtyOnHand = 0): Promise<Item> {
  return create(db.items, {
    name: `Item ${sku}`,
    sku,
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: 'A1',
    qtyOnHand,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: true,
    archived: false,
  });
}

function rule(overrides: Partial<ConsumptionLine>): ConsumptionLine {
  return {
    id: 'line',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    rev: 1,
    deviceId: 'test',
    syncedAt: null,
    eventId: 'event',
    destinationId: 'destination',
    itemId: 'item',
    perRunner: 0,
    flatQty: 0,
    note: '',
    sort: 10,
    raceId: null,
    ...overrides,
  };
}

/** A two-day weekend: marathon Saturday, 17k and kids Sunday, all through one station. */
async function weekend() {
  const event = await makeEvent();
  const marathon = await makeRace(event.id, 'Marathon', 450, '2026-09-12');
  const seventeen = await makeRace(event.id, '17k', 612, '2026-09-13');
  const kids = await makeRace(event.id, 'Kids', 80, '2026-09-13');
  const station = await makeDestination(event.id, [
    { raceId: marathon.id, passes: 1 },
    { raceId: seventeen.id, passes: 1 },
    { raceId: kids.id, passes: 1 },
  ]);
  const races = [marathon, seventeen, kids];
  return { event, marathon, seventeen, kids, station, races };
}

describe('stationRunners', () => {
  it('sums the projections of the races through the station', async () => {
    const { station, races } = await weekend();
    expect(stationRunners(station, races)).toBe(1142);
  });

  it('counts a race once per pass — an out-and-back eats twice', async () => {
    const event = await makeEvent();
    const fifty = await makeRace(event.id, '50k', 150);
    const destination = await makeDestination(event.id, [{ raceId: fifty.id, passes: 2 }]);
    expect(stationRunners(destination, [fifty])).toBe(300);
  });

  it('ignores deleted races and stale links', async () => {
    const event = await makeEvent();
    const fifty = await makeRace(event.id, '50k', 150);
    await softDelete(db.races, fifty.id);
    const gone = await db.races.get(fifty.id);
    const destination = await makeDestination(event.id, [
      { raceId: fifty.id, passes: 1 },
      { raceId: 'never-existed', passes: 1 },
    ]);
    expect(stationRunners(destination, [gone!])).toBe(0);
  });
});

describe('stationRunnersByDay', () => {
  it('splits the field by the day each race runs, in date order', async () => {
    const { station, races } = await weekend();
    expect(stationRunnersByDay(station, races)).toEqual([
      ['2026-09-12', 450],
      ['2026-09-13', 692],
    ]);
  });

  it('keeps undated races together, after the dated ones', async () => {
    const event = await makeEvent();
    const dated = await makeRace(event.id, '50k', 100, '2026-09-12');
    const undated = await makeRace(event.id, '20k', 50);
    const station = await makeDestination(event.id, [
      { raceId: undated.id, passes: 1 },
      { raceId: dated.id, passes: 1 },
    ]);
    expect(stationRunnersByDay(station, [dated, undated])).toEqual([
      ['2026-09-12', 100],
      [null, 50],
    ]);
  });
});

describe('lineQty', () => {
  it('rounds the per-runner part up — part of a pack still has to be bought', () => {
    expect(lineQty(rule({ perRunner: 0.02247191011 }), 300)).toBe(7);
  });

  it('does not let floating point round an exact answer up', () => {
    // 0.2 × 430 is 86.00000000000001 in floats; the crew must see 86.
    expect(lineQty(rule({ perRunner: 0.2 }), 430)).toBe(86);
  });

  it('adds the flat quantity on top, unscaled', () => {
    expect(lineQty(rule({ perRunner: 0.1, flatQty: 2 }), 100)).toBe(12);
  });
});

describe('lineQtyByDay', () => {
  it('lands a one-race rule on that race’s day only', async () => {
    const { station, races, marathon } = await weekend();
    const coke = rule({ raceId: marathon.id, perRunner: 0.1 });
    expect(lineQtyByDay(coke, station, races)).toEqual([['2026-09-12', 45]]);
  });

  it('counts nothing for a race that does not pass this station', async () => {
    const { station, races, marathon } = await weekend();
    const elsewhere = await makeDestination(station.eventId, [{ raceId: marathon.id, passes: 1 }]);
    const seventeen = races[1];
    expect(lineQtyByDay(rule({ raceId: seventeen.id, perRunner: 1 }), elsewhere, races)).toEqual([]);
  });

  it('rounds an every-race rule up day by day, flat amount on the first day', async () => {
    const { station, races } = await weekend();
    // 0.0225 × 450 = 10.125 → 11 on Saturday; × 692 = 15.57 → 16 on Sunday.
    const electrolyte = rule({ perRunner: 0.0225, flatQty: 1 });
    expect(lineQtyByDay(electrolyte, station, races)).toEqual([
      ['2026-09-12', 12],
      ['2026-09-13', 16],
    ]);
    expect(lineTotal(electrolyte, station, races)).toBe(28);
  });

  it('gives a station with no races its flat amounts on an undated line', async () => {
    const event = await makeEvent();
    const empty = await makeDestination(event.id);
    expect(lineQtyByDay(rule({ flatQty: 1 }), empty, [])).toEqual([[null, 1]]);
    expect(lineQtyByDay(rule({ perRunner: 1 }), empty, [])).toEqual([]);
  });
});

describe('eventDays', () => {
  it('lists every date the event covers', () => {
    expect(eventDays({ startDate: '2026-09-11', endDate: '2026-09-13' })).toEqual([
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(eventDays({ startDate: '2026-10-17', endDate: '2026-10-17' })).toEqual(['2026-10-17']);
  });
});

describe('totalsToOrder', () => {
  it('sums an item across stations and days and nets off stock on hand', async () => {
    const { event, station, races, marathon, seventeen } = await weekend();
    const water = await makeItem('WTR', 500);
    const other = await makeDestination(event.id, [{ raceId: marathon.id, passes: 1 }]);
    const lines = [
      rule({ id: 'a', destinationId: station.id, itemId: water.id, raceId: marathon.id, perRunner: 0.8 }),
      rule({ id: 'b', destinationId: station.id, itemId: water.id, raceId: seventeen.id, perRunner: 1.2 }),
      rule({ id: 'c', destinationId: other.id, itemId: water.id, perRunner: 0.75 }),
    ];
    const [total] = totalsToOrder(lines, [station, other], races, [water]);
    // Saturday: 360 at the station + 338 at the other; Sunday: 735.
    expect(total.byDay).toEqual([
      ['2026-09-12', 698],
      ['2026-09-13', 735],
    ]);
    expect(total.total).toBe(1433);
    expect(total.onHand).toBe(500);
    expect(total.toOrder).toBe(933);
  });

  it('never asks to order a negative quantity', async () => {
    const { station, races } = await weekend();
    const coke = await makeItem('COKE', 1000);
    const [total] = totalsToOrder([rule({ destinationId: station.id, itemId: coke.id, perRunner: 0.2 })], [station], races, [coke]);
    expect(total.toOrder).toBe(0);
  });

  it('puts shortfalls first and drops deleted or zero lines', async () => {
    const { station, races } = await weekend();
    const covered = await makeItem('OK', 5000);
    const short = await makeItem('SHORT', 0);
    const zeroed = await makeItem('ZERO', 0);
    const deleted = await makeItem('GONE', 0);
    const lines = [
      rule({ id: 'a', destinationId: station.id, itemId: covered.id, perRunner: 0.5 }),
      rule({ id: 'b', destinationId: station.id, itemId: short.id, perRunner: 0.5 }),
      rule({ id: 'c', destinationId: station.id, itemId: zeroed.id, perRunner: 0 }),
      rule({ id: 'd', destinationId: station.id, itemId: deleted.id, perRunner: 1, deletedAt: 'gone' }),
    ];
    const totals = totalsToOrder(lines, [station], races, [covered, short, zeroed, deleted]);
    expect(totals.map((total) => total.item.id)).toEqual([short.id, covered.id]);
  });
});

describe('addPlanItems and copyRuleForRace', () => {
  it('adds every-race rules and skips items already planned', async () => {
    const { event, station } = await weekend();
    const water = await makeItem('WTR');
    const coke = await makeItem('COKE');
    expect(await addPlanItems(event.id, station.id, [{ itemId: water.id, qty: 1 }])).toBe(1);
    expect(
      await addPlanItems(event.id, station.id, [
        { itemId: water.id, qty: 5 },
        { itemId: coke.id, qty: 2 },
      ]),
    ).toBe(1);
    const lines = await liveWhere(db.consumptionLines, 'destinationId', station.id);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => !line.raceId)).toBe(true);
  });

  it('copies a rule for another race, keeping the ratio but not the flat amount', async () => {
    const { event, station, marathon, seventeen } = await weekend();
    const coke = await makeItem('COKE');
    await addPlanItems(event.id, station.id, [{ itemId: coke.id, qty: 1 }]);
    const [original] = await liveWhere(db.consumptionLines, 'destinationId', station.id);
    await db.consumptionLines.put({ ...original, perRunner: 0.1, raceId: marathon.id });

    const copy = await copyRuleForRace({ ...original, perRunner: 0.1, raceId: marathon.id }, seventeen.id);
    expect(copy.raceId).toBe(seventeen.id);
    expect(copy.perRunner).toBe(0.1);
    expect(copy.flatQty).toBe(0);
    expect(await liveWhere(db.consumptionLines, 'destinationId', station.id)).toHaveLength(2);
  });
});

describe('applyPlanToPacklists', () => {
  async function planned() {
    const weekendPlan = await weekend();
    const water = await makeItem('WTR');
    const { event, station, marathon, seventeen } = weekendPlan;
    await create(db.consumptionLines, {
      eventId: event.id, destinationId: station.id, itemId: water.id,
      perRunner: 0.8, flatQty: 0, note: '', sort: 10, raceId: marathon.id,
    });
    await create(db.consumptionLines, {
      eventId: event.id, destinationId: station.id, itemId: water.id,
      perRunner: 1.2, flatQty: 0, note: '', sort: 20, raceId: seventeen.id,
    });
    return { ...weekendPlan, water };
  }

  it('creates the packlist and adds up every rule for an item into one line', async () => {
    const { event, station, water } = await planned();
    const result = await applyPlanToPacklists(event.id, [station]);
    expect(result).toEqual({ stations: 1, created: 1, lines: 1 });

    const packlists = alive(await db.packlists.where('destinationId').equals(station.id).toArray());
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlists[0].id);
    expect(lines).toHaveLength(1);
    expect(lines[0].itemId).toBe(water.id);
    expect(lines[0].qtyRequired).toBe(360 + 735);
    // The station can see how much of it is Saturday's.
    expect(lines[0].note).toBe('Food plan: Sat 360 · Sun 735');
  });

  it('sets rather than adds, so re-applying lands on the new projection', async () => {
    const { event, station, marathon } = await planned();
    await applyPlanToPacklists(event.id, [station]);
    await db.races.put({ ...(await db.races.get(marathon.id))!, projection: 500 });

    const again = await applyPlanToPacklists(event.id, [station]);
    expect(again.created).toBe(0);
    const packlists = alive(await db.packlists.where('destinationId').equals(station.id).toArray());
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlists[0].id);
    expect(lines[0].qtyRequired).toBe(400 + 735);
    expect(lines[0].note).toBe('Food plan: Sat 400 · Sun 735');
  });

  it('leaves hand-added lines and hand-written notes alone', async () => {
    const { event, station } = await planned();
    await applyPlanToPacklists(event.id, [station]);
    const packlist = alive(await db.packlists.where('destinationId').equals(station.id).toArray())[0];
    const gazebo = await makeItem('GAZ');
    await addLine(packlist.id, gazebo.id, 2);
    const [waterLine] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...waterLine, note: 'Fill from the tank, not bottles' });

    await applyPlanToPacklists(event.id, [station]);
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    expect(lines.find((line) => line.itemId === gazebo.id)?.qtyRequired).toBe(2);
    expect(lines.find((line) => line.id === waterLine.id)?.note).toBe('Fill from the tank, not bottles');
  });

  it('fills the list the crew is working when a station has two', async () => {
    const { event, station, water } = await planned();
    // A tap on the station before its run sheet arrived left an empty list
    // whose random id sorts ahead of the seeded one.
    const stray = await createPacklist(station);
    const seeded = await create(db.packlists, {
      id: 'stw-plist-hc26-station',
      eventId: event.id,
      destinationId: station.id,
      name: station.name,
      code: 'ST-02',
      status: 'draft',
      packedBy: '',
      packedAt: null,
      deliveredAt: null,
      receivedBy: '',
      notes: '',
    });
    await addLine(seeded.id, (await makeItem('GAZ')).id, 1);

    const result = await applyPlanToPacklists(event.id, [station]);
    expect(result).toEqual({ stations: 1, created: 0, lines: 1 });
    const onSeeded = await liveWhere(db.packlistLines, 'packlistId', seeded.id);
    expect(onSeeded.find((line) => line.itemId === water.id)?.qtyRequired).toBe(360 + 735);
    expect(await liveWhere(db.packlistLines, 'packlistId', stray.id)).toHaveLength(0);
  });

  it('skips a station whose plan computes to nothing', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id);
    const water = await makeItem('WTR');
    await create(db.consumptionLines, {
      eventId: event.id, destinationId: destination.id, itemId: water.id,
      perRunner: 1, flatQty: 0, note: '', sort: 10, raceId: null,
    });
    expect(await applyPlanToPacklists(event.id, [destination])).toEqual({ stations: 0, created: 0, lines: 0 });
    expect(alive(await db.packlists.where('destinationId').equals(destination.id).toArray())).toHaveLength(0);
  });
});

describe('loadFoodPlan', () => {
  it('reads races and lines in one go', async () => {
    const { event, station } = await weekend();
    const water = await makeItem('WTR');
    await create(db.consumptionLines, {
      eventId: event.id, destinationId: station.id, itemId: water.id,
      perRunner: 1, flatQty: 0, note: '', sort: 10, raceId: null,
    });
    const plan = await loadFoodPlan(event.id);
    expect(plan.races).toHaveLength(3);
    expect(plan.lines).toHaveLength(1);
  });
});
