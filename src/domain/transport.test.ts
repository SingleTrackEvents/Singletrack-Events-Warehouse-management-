import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, liveWhere } from '../db/repo';
import { addLine } from './packlists';
import {
  addStop,
  completeLoad,
  createLoad,
  deliverStop,
  departLoad,
  loadProgress,
  moveStop,
  removeStop,
  unassignedDestinations,
} from './transport';
import type { Destination, LoadStop } from '../db/types';

async function makeEvent() {
  return create(db.events, {
    name: 'Buffalo Stampede',
    location: 'Bright',
    startDate: '2026-04-04',
    endDate: '2026-04-04',
    status: 'packing',
    notes: '',
  });
}

async function makeDestination(eventId: string, name: string, sort: number): Promise<Destination> {
  return create(db.destinations, {
    eventId,
    name,
    type: 'aid_station',
    courseKm: sort,
    access: '4wd',
    accessNotes: '',
    lat: null,
    lng: null,
    crewLead: '',
    phone: '',
    openTime: '06:00',
    closeTime: '16:00',
    notes: '',
    sort,
  });
}

async function makePacklist(destination: Destination, code: string) {
  return create(db.packlists, {
    eventId: destination.eventId,
    destinationId: destination.id,
    name: destination.name,
    code,
    status: 'packed',
    packedBy: '',
    packedAt: null,
    deliveredAt: null,
    receivedBy: '',
    notes: '',
  });
}

async function makeItem(qtyOnHand: number) {
  return create(db.items, {
    name: 'Water cube 20L',
    sku: 'HYD-CUBE20',
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: 'A1',
    qtyOnHand,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
  });
}

describe('run sheets', () => {
  it('adds stops in order and refuses a duplicate destination', async () => {
    const event = await makeEvent();
    const first = await makeDestination(event.id, 'Aid 1', 10);
    const load = await createLoad(event.id, { name: 'Run 1' });

    expect(await addStop(load.id, first.id)).not.toBeNull();
    expect(await addStop(load.id, first.id)).toBeNull();
    expect(await liveWhere(db.loadStops, 'loadId', load.id)).toHaveLength(1);
  });

  it('reorders stops without disturbing the rest', async () => {
    const event = await makeEvent();
    const a = await makeDestination(event.id, 'Aid 1', 10);
    const b = await makeDestination(event.id, 'Aid 2', 20);
    const c = await makeDestination(event.id, 'Aid 3', 30);
    const load = await createLoad(event.id);
    for (const destination of [a, b, c]) await addStop(load.id, destination.id);

    const stops = await liveWhere(db.loadStops, 'loadId', load.id);
    await moveStop(stops, stops[2].id, -1);

    const reordered = await liveWhere(db.loadStops, 'loadId', load.id);
    expect(reordered.map((stop) => stop.destinationId)).toEqual([a.id, c.id, b.id]);
  });

  it('ignores a move that would fall off either end', async () => {
    const event = await makeEvent();
    const a = await makeDestination(event.id, 'Aid 1', 10);
    const load = await createLoad(event.id);
    await addStop(load.id, a.id);

    const stops = await liveWhere(db.loadStops, 'loadId', load.id);
    await moveStop(stops, stops[0].id, -1);

    expect((await liveWhere(db.loadStops, 'loadId', load.id))[0].sort).toBe(stops[0].sort);
  });

  it('drops a removed stop out of the run sheet', async () => {
    const event = await makeEvent();
    const a = await makeDestination(event.id, 'Aid 1', 10);
    const load = await createLoad(event.id);
    const stop = await addStop(load.id, a.id);

    await removeStop(stop!.id);
    expect(await liveWhere(db.loadStops, 'loadId', load.id)).toHaveLength(0);
  });

  it('lists destinations no load is calling at', async () => {
    const event = await makeEvent();
    const a = await makeDestination(event.id, 'Aid 1', 10);
    const b = await makeDestination(event.id, 'Aid 2', 20);
    const load = await createLoad(event.id);
    await addStop(load.id, a.id);
    const stops = await liveWhere(db.loadStops, 'loadId', load.id);

    expect(unassignedDestinations([a, b], stops).map((entry) => entry.id)).toEqual([b.id]);
  });
});

describe('progress', () => {
  const stop = (overrides: Partial<LoadStop>): LoadStop =>
    ({ sort: 10, arrivedAt: null, deletedAt: null, ...overrides }) as LoadStop;

  it('counts delivered stops and points at the next one', () => {
    const progress = loadProgress([
      stop({ id: '1', sort: 10, arrivedAt: '2026-04-04T06:00:00.000Z' }),
      stop({ id: '2', sort: 20 }),
      stop({ id: '3', sort: 30 }),
    ]);

    expect(progress.delivered).toBe(1);
    expect(progress.percent).toBe(33);
    expect(progress.nextStop?.id).toBe('2');
  });

  it('has no next stop once everything is delivered', () => {
    const progress = loadProgress([stop({ id: '1', arrivedAt: '2026-04-04T06:00:00.000Z' })]);
    expect(progress.percent).toBe(100);
    expect(progress.nextStop).toBeNull();
  });
});

describe('departing and delivering', () => {
  it('issues everything on board when the vehicle leaves', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id, 'Aid 1', 10);
    const packlist = await makePacklist(destination, 'A1-7K2M');
    const item = await makeItem(20);
    await addLine(packlist.id, item.id, 4);
    const [entry] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...entry, qtyPacked: 4 });

    const load = await createLoad(event.id);
    await addStop(load.id, destination.id);
    await departLoad(load, 'Dan');

    expect((await db.items.get(item.id))!.qtyOnHand).toBe(16);
    expect((await db.packlists.get(packlist.id))!.status).toBe('loaded');
    expect((await db.loads.get(load.id))!.status).toBe('in_transit');
    expect((await db.loads.get(load.id))!.departedAt).not.toBeNull();
  });

  it('marks the stop and its packlists delivered, with a signature', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id, 'Aid 1', 10);
    const packlist = await makePacklist(destination, 'A1-7K2M');
    const load = await createLoad(event.id);
    const stop = (await addStop(load.id, destination.id))!;

    await deliverStop(stop, { signedBy: 'Priya', notes: 'Left at the gate' });

    const saved = (await db.loadStops.get(stop.id))!;
    expect(saved.arrivedAt).not.toBeNull();
    expect(saved.signedBy).toBe('Priya');
    expect(saved.notes).toBe('Left at the gate');
    expect((await db.packlists.get(packlist.id))!.status).toBe('delivered');
    expect((await db.packlists.get(packlist.id))!.receivedBy).toBe('Priya');
  });

  it('does not re-issue stock when a stop is delivered after departure', async () => {
    const event = await makeEvent();
    const destination = await makeDestination(event.id, 'Aid 1', 10);
    const packlist = await makePacklist(destination, 'A1-7K2M');
    const item = await makeItem(20);
    await addLine(packlist.id, item.id, 4);
    const [entry] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...entry, qtyPacked: 4 });

    const load = await createLoad(event.id);
    const stop = (await addStop(load.id, destination.id))!;
    await departLoad(load);
    await deliverStop(stop, { signedBy: 'Priya' });

    expect((await db.items.get(item.id))!.qtyOnHand).toBe(16);
    expect(await db.movements.count()).toBe(1);
  });

  it('closes the run', async () => {
    const event = await makeEvent();
    const load = await createLoad(event.id);
    await completeLoad(load.id);

    const saved = (await db.loads.get(load.id))!;
    expect(saved.status).toBe('complete');
    expect(saved.completedAt).not.toBeNull();
  });
});
