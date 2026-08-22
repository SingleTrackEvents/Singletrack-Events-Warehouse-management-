import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create } from '../db/repo';
import { describeEventRemoval, removeEvent, removeLoad } from './remove';

async function fullEvent() {
  const event = await create(db.events, {
    name: 'Buffalo Stampede', location: 'Bright', startDate: '2026-04-04',
    endDate: '2026-04-04', status: 'packing', notes: '',
  });
  const destination = await create(db.destinations, {
    eventId: event.id, name: 'Aid 3', type: 'aid_station', courseKm: 42, access: '4wd',
    accessNotes: '', lat: null, lng: null, crewLead: '', phone: '', openTime: '07:00',
    closeTime: '16:00', notes: '', sort: 10,
  });
  const packlist = await create(db.packlists, {
    eventId: event.id, destinationId: destination.id, name: 'Aid 3', code: 'A3-7K2M',
    status: 'draft', packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
  });
  const line = await create(db.packlistLines, {
    packlistId: packlist.id, itemId: 'item-1', qtyRequired: 4, qtyPacked: 0, qtyReturned: 0,
    mandatory: false, containerId: null, note: '', sort: 10,
  });
  const container = await create(db.containers, {
    packlistId: packlist.id, code: 'A3-7K2M/01', type: 'crate', sealed: false, notes: '',
  });
  const load = await create(db.loads, {
    eventId: event.id, name: 'Run 1', vehicle: '6m Truck', driver: 'Dan', phone: '',
    status: 'planned', departAt: null, departedAt: null, completedAt: null, notes: '',
  });
  const stop = await create(db.loadStops, {
    loadId: load.id, destinationId: destination.id, sort: 10, arrivedAt: null,
    signedBy: '', notes: '',
  });
  return { event, destination, packlist, line, container, load, stop };
}

describe('removing an event', () => {
  it('says what it will take with it before anything changes', async () => {
    const { event } = await fullEvent();

    const summary = await describeEventRemoval(event.id);

    expect(summary).toEqual({ destinations: 1, packlists: 1, loads: 1 });
    expect((await db.events.get(event.id))!.deletedAt).toBeNull();
  });

  it('takes the destinations, packlists, lines, crates, loads and stops', async () => {
    const parts = await fullEvent();

    await removeEvent(parts.event.id);

    for (const [table, id] of [
      [db.events, parts.event.id],
      [db.destinations, parts.destination.id],
      [db.packlists, parts.packlist.id],
      [db.packlistLines, parts.line.id],
      [db.containers, parts.container.id],
      [db.loads, parts.load.id],
      [db.loadStops, parts.stop.id],
    ] as const) {
      const row = await (table as { get(id: string): Promise<{ deletedAt: string | null } | undefined> }).get(id);
      expect(row!.deletedAt).not.toBeNull();
    }
  });

  it('tombstones rather than destroys, so the removal reaches other phones', async () => {
    const { event } = await fullEvent();
    await removeEvent(event.id);

    // Still present in the table, which is what lets sync replicate the delete.
    expect(await db.events.get(event.id)).toBeDefined();
    expect(alive(await db.events.toArray())).toHaveLength(0);
  });

  it('leaves the stock ledger alone', async () => {
    // Deleting a race must not rewrite the history of what left the warehouse.
    const { event } = await fullEvent();
    const movement = await create(db.movements, {
      itemId: 'item-1', qty: -4, reason: 'issue', balanceAfter: 20,
      refType: 'packlist', refId: 'pl-1', note: 'Aid 3', by: 'Chad',
    });

    await removeEvent(event.id);

    expect((await db.movements.get(movement.id))!.deletedAt).toBeNull();
  });

  it('leaves another event untouched', async () => {
    const first = await fullEvent();
    const second = await fullEvent();

    await removeEvent(first.event.id);

    expect((await db.events.get(second.event.id))!.deletedAt).toBeNull();
    expect((await db.packlists.get(second.packlist.id))!.deletedAt).toBeNull();
  });
});

describe('removing a transport run', () => {
  it('takes its stops with it', async () => {
    const { load, stop } = await fullEvent();

    await removeLoad(load.id);

    expect((await db.loads.get(load.id))!.deletedAt).not.toBeNull();
    expect((await db.loadStops.get(stop.id))!.deletedAt).not.toBeNull();
  });

  it('leaves the packlists it was carrying alone', async () => {
    // The gear still needs packing; only the run is cancelled.
    const { load, packlist, destination } = await fullEvent();

    await removeLoad(load.id);

    expect((await db.packlists.get(packlist.id))!.deletedAt).toBeNull();
    expect((await db.destinations.get(destination.id))!.deletedAt).toBeNull();
  });
});
