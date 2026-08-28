import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create, liveWhere, softDelete } from '../db/repo';
import {
  addPlanItems,
  applyPlanToPacklists,
  lineQty,
  loadFoodPlan,
  stationRunners,
  totalsToOrder,
} from './consumption';
import { addLine } from './packlists';
import type { ConsumptionLine, Destination, Item, Race, RaceVisit } from '../db/types';

async function makeEvent() {
  return create(db.events, {
    name: 'Wonderland Run',
    location: 'Halls Gap',
    startDate: '2026-10-03',
    endDate: '2026-10-04',
    status: 'planning',
    notes: '',
  });
}

async function makeDestination(eventId: string, raceVisits?: RaceVisit[]): Promise<Destination> {
  return create(db.destinations, {
    eventId,
    name: 'Rosea Carpark',
    type: 'aid_station',
    courseKm: 21,
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

async function makeRace(eventId: string, name: string, projection: number): Promise<Race> {
  return create(db.races, { eventId, name, projection, sort: 10 });
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

function planLine(overrides: Partial<ConsumptionLine>): ConsumptionLine {
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
    ...overrides,
  };
}

describe('stationRunners', () => {
  it('sums the projections of the races through the station', async () => {
    const event = await makeEvent();
    const fifty = await makeRace(event.id, '50k', 150);
    const thirty = await makeRace(event.id, '30k', 150);
    const destination = await makeDestination(event.id, [
      { raceId: fifty.id, passes: 1 },
      { raceId: thirty.id, passes: 1 },
    ]);
    const races = alive(await db.races.toArray());
    expect(stationRunners(destination, races)).toBe(300);
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

  it('reads a destination from before food planning as no races', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id);
    expect(stationRunners(destination, [])).toBe(0);
  });
});

describe('lineQty', () => {
  it('rounds the per-runner part up — part of a pack still has to be bought', () => {
    expect(lineQty(planLine({ perRunner: 0.02247191011 }), 300)).toBe(7);
  });

  it('does not let floating point round an exact answer up', () => {
    // 0.2 × 430 is 86.00000000000001 in floats; the crew must see 86.
    expect(lineQty(planLine({ perRunner: 0.2 }), 430)).toBe(86);
  });

  it('adds the flat quantity on top, unscaled', () => {
    expect(lineQty(planLine({ perRunner: 0.1, flatQty: 2 }), 100)).toBe(12);
  });

  it('is just the flat quantity when nothing scales or nobody runs', () => {
    expect(lineQty(planLine({ flatQty: 1 }), 810)).toBe(1);
    expect(lineQty(planLine({ perRunner: 0.5, flatQty: 1 }), 0)).toBe(1);
  });
});

describe('totalsToOrder', () => {
  it('sums an item across stations and nets off stock on hand', async () => {
    const water = await makeItem('WTR', 500);
    const runners = new Map([
      ['station-a', 300],
      ['station-b', 810],
    ]);
    const lines = [
      planLine({ id: 'a', destinationId: 'station-a', itemId: water.id, perRunner: 1 }),
      planLine({ id: 'b', destinationId: 'station-b', itemId: water.id, perRunner: 1 }),
    ];
    const totals = totalsToOrder(lines, runners, [water]);
    expect(totals).toHaveLength(1);
    expect(totals[0].total).toBe(1110);
    expect(totals[0].onHand).toBe(500);
    expect(totals[0].toOrder).toBe(610);
  });

  it('never asks to order a negative quantity', async () => {
    const coke = await makeItem('COKE', 1000);
    const lines = [planLine({ itemId: coke.id, perRunner: 0.2 })];
    const totals = totalsToOrder(lines, new Map([['destination', 300]]), [coke]);
    expect(totals[0].toOrder).toBe(0);
  });

  it('puts shortfalls first and drops deleted or zero lines', async () => {
    const covered = await makeItem('OK', 100);
    const short = await makeItem('SHORT', 0);
    const zeroed = await makeItem('ZERO', 0);
    const deleted = await makeItem('GONE', 0);
    const runners = new Map([['destination', 100]]);
    const lines = [
      planLine({ id: 'a', itemId: covered.id, perRunner: 0.5 }),
      planLine({ id: 'b', itemId: short.id, perRunner: 0.5 }),
      planLine({ id: 'c', itemId: zeroed.id, perRunner: 0 }),
      planLine({ id: 'd', itemId: deleted.id, perRunner: 1, deletedAt: 'gone' }),
    ];
    const totals = totalsToOrder(lines, runners, [covered, short, zeroed, deleted]);
    expect(totals.map((total) => total.item.id)).toEqual([short.id, covered.id]);
  });
});

describe('addPlanItems', () => {
  it('adds new lines and skips items already planned', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id);
    const water = await makeItem('WTR');
    const coke = await makeItem('COKE');

    const first = await addPlanItems(event.id, destination.id, [
      { itemId: water.id, qty: 1 },
    ]);
    expect(first).toBe(1);

    const second = await addPlanItems(event.id, destination.id, [
      { itemId: water.id, qty: 5 },
      { itemId: coke.id, qty: 2 },
    ]);
    expect(second).toBe(1);

    const lines = await liveWhere(db.consumptionLines, 'destinationId', destination.id);
    expect(lines).toHaveLength(2);
    const existing = lines.find((line) => line.itemId === water.id);
    expect(existing?.flatQty).toBe(1);
  });
});

describe('applyPlanToPacklists', () => {
  async function makePlan() {
    const event = await makeEvent();
    const fifty = await makeRace(event.id, '50k', 150);
    const thirty = await makeRace(event.id, '30k', 150);
    const destination = await makeDestination(event.id, [
      { raceId: fifty.id, passes: 1 },
      { raceId: thirty.id, passes: 1 },
    ]);
    const water = await makeItem('WTR');
    await create(db.consumptionLines, {
      eventId: event.id,
      destinationId: destination.id,
      itemId: water.id,
      perRunner: 1,
      flatQty: 0,
      note: '',
      sort: 10,
    });
    return { event, destination, water, fifty };
  }

  it('creates the packlist and writes the computed quantities', async () => {
    const { event, destination, water } = await makePlan();
    const result = await applyPlanToPacklists(event.id, [destination]);
    expect(result).toEqual({ stations: 1, created: 1, lines: 1 });

    const packlists = alive(await db.packlists.where('destinationId').equals(destination.id).toArray());
    expect(packlists).toHaveLength(1);
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlists[0].id);
    expect(lines).toHaveLength(1);
    expect(lines[0].itemId).toBe(water.id);
    expect(lines[0].qtyRequired).toBe(300);
  });

  it('sets rather than adds, so re-applying lands on the new projection', async () => {
    const { event, destination, fifty } = await makePlan();
    await applyPlanToPacklists(event.id, [destination]);
    // The 50k field grows by fifty; the station's demand moves with it.
    await db.races.put({ ...(await db.races.get(fifty.id))!, projection: 200 });

    const again = await applyPlanToPacklists(event.id, [destination]);
    expect(again.created).toBe(0);

    const packlists = alive(await db.packlists.where('destinationId').equals(destination.id).toArray());
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlists[0].id);
    expect(lines).toHaveLength(1);
    expect(lines[0].qtyRequired).toBe(350);
  });

  it('leaves hand-added packlist lines alone', async () => {
    const { event, destination } = await makePlan();
    await applyPlanToPacklists(event.id, [destination]);
    const packlist = alive(await db.packlists.where('destinationId').equals(destination.id).toArray())[0];
    const gazebo = await makeItem('GAZ');
    await addLine(packlist.id, gazebo.id, 2);

    await applyPlanToPacklists(event.id, [destination]);
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    const manual = lines.find((line) => line.itemId === gazebo.id);
    expect(manual?.qtyRequired).toBe(2);
  });

  it('skips a station whose plan computes to nothing', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id);
    const water = await makeItem('WTR');
    await create(db.consumptionLines, {
      eventId: event.id,
      destinationId: destination.id,
      itemId: water.id,
      perRunner: 1,
      flatQty: 0,
      note: '',
      sort: 10,
    });

    const result = await applyPlanToPacklists(event.id, [destination]);
    expect(result).toEqual({ stations: 0, created: 0, lines: 0 });
    const packlists = alive(await db.packlists.where('destinationId').equals(destination.id).toArray());
    expect(packlists).toHaveLength(0);
  });
});

describe('loadFoodPlan', () => {
  it('reads races, lines and runner estimates in one go', async () => {
    const event = await makeEvent();
    const fifty = await makeRace(event.id, '50k', 150);
    const destination = await makeDestination(event.id, [{ raceId: fifty.id, passes: 2 }]);
    const water = await makeItem('WTR');
    await create(db.consumptionLines, {
      eventId: event.id,
      destinationId: destination.id,
      itemId: water.id,
      perRunner: 1,
      flatQty: 0,
      note: '',
      sort: 10,
    });

    const plan = await loadFoodPlan(event.id, [destination]);
    expect(plan.races).toHaveLength(1);
    expect(plan.lines).toHaveLength(1);
    expect(plan.runners.get(destination.id)).toBe(300);
  });
});
