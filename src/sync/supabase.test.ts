import { describe, expect, it } from 'vitest';
import { fromWire, loadParentScopes, scopeOf, toWire } from './supabase';
import { db } from '../db/db';
import { create } from '../db/repo';
import type { SyncMeta } from '../db/types';

/**
 * The adapter's network calls cannot be exercised here, but the mapping can —
 * and the mapping is where a mistake would leak rows past a volunteer's scope,
 * because these two columns are exactly what the security policies filter on.
 */

const meta = (overrides: Partial<SyncMeta> = {}): SyncMeta => ({
  id: 'row-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
  rev: 3,
  deviceId: 'device-a',
  syncedAt: null,
  ...overrides,
});

describe('scope extraction', () => {
  it('lets an event identify itself by its own id', () => {
    expect(scopeOf('events', meta({ id: 'event-1' }))).toEqual({
      event_id: 'event-1',
      destination_id: null,
    });
  });

  it('gives a destination both its own id and its parent event', () => {
    expect(scopeOf('destinations', meta({ id: 'dest-3', eventId: 'event-1' } as never))).toEqual({
      event_id: 'event-1',
      destination_id: 'dest-3',
    });
  });

  it('reads foreign keys off everything else', () => {
    const packlist = meta({ id: 'pl-1', eventId: 'event-1', destinationId: 'dest-3' } as never);
    expect(scopeOf('packlists', packlist)).toEqual({
      event_id: 'event-1',
      destination_id: 'dest-3',
    });
  });

  it('leaves warehouse-wide rows unscoped so crew see them everywhere', () => {
    expect(scopeOf('items', meta())).toEqual({ event_id: null, destination_id: null });
    expect(scopeOf('categories', meta())).toEqual({ event_id: null, destination_id: null });
  });

  it('leaves a packlist line unscoped when its parent is unknown', () => {
    // Lines reference only their packlist, so without the parent there is
    // genuinely nothing to scope on — and the server must reject that rather
    // than treat it as "applies everywhere".
    const line = meta({ id: 'line-1', packlistId: 'pl-1' } as never);
    expect(scopeOf('packlistLines', line)).toEqual({ event_id: null, destination_id: null });
  });
});

/**
 * These use the real record shapes on purpose. An earlier version of this file
 * passed synthetic objects carrying a destinationId that PacklistLine does not
 * actually have, so it went green while the adapter was pushing packlist lines
 * with no scope at all — which the security policies filter on.
 */
describe('inherited scope, against real records', () => {
  async function realPacklist() {
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
    return { event, destination, packlist };
  }

  it('gives a real packlist line its parent event and destination', async () => {
    const { event, destination, packlist } = await realPacklist();
    const line = await create(db.packlistLines, {
      packlistId: packlist.id, itemId: 'item-1', qtyRequired: 4, qtyPacked: 0, qtyReturned: 0,
      mandatory: true, containerId: null, note: '', sort: 10,
    });

    const changes = { packlistLines: [line] };
    const [wire] = toWire(changes, await loadParentScopes(changes));

    expect(wire.event_id).toBe(event.id);
    expect(wire.destination_id).toBe(destination.id);
  });

  it('gives a real crate label its parent scope too', async () => {
    const { destination, packlist } = await realPacklist();
    const container = await create(db.containers, {
      packlistId: packlist.id, code: 'A3-7K2M/01', type: 'crate', sealed: false, notes: '',
    });

    const changes = { containers: [container] };
    const [wire] = toWire(changes, await loadParentScopes(changes));

    expect(wire.destination_id).toBe(destination.id);
  });

  it('gives a load stop its event from the load it belongs to', async () => {
    const { event, destination } = await realPacklist();
    const load = await create(db.loads, {
      eventId: event.id, name: 'Run 1', vehicle: 'Hilux', driver: 'Dan', phone: '',
      status: 'planned', departAt: null, departedAt: null, completedAt: null, notes: '',
    });
    const stop = await create(db.loadStops, {
      loadId: load.id, destinationId: destination.id, sort: 10, arrivedAt: null,
      signedBy: '', notes: '',
    });

    const changes = { loadStops: [stop] };
    const [wire] = toWire(changes, await loadParentScopes(changes));

    expect(wire.event_id).toBe(event.id);
    expect(wire.destination_id).toBe(destination.id);
  });

  it('only fetches the parents actually referenced', async () => {
    const parents = await loadParentScopes({});
    expect(parents.packlists.size).toBe(0);
    expect(parents.loads.size).toBe(0);
  });
});

describe('wire format', () => {
  it('lifts the fields the policies filter on out of the payload', () => {
    const row = meta({ id: 'pl-1', eventId: 'event-1', destinationId: 'dest-3' } as never);
    const [wire] = toWire({ packlists: [row] });

    expect(wire).toMatchObject({
      table_name: 'packlists',
      id: 'pl-1',
      rev: 3,
      updated_at: '2026-01-02T00:00:00.000Z',
      deleted_at: null,
      device_id: 'device-a',
      event_id: 'event-1',
      destination_id: 'dest-3',
    });
    // The whole record still travels intact, so nothing is lost in translation.
    expect(wire.data).toEqual(row);
  });

  it('carries tombstones so deletions replicate', () => {
    const [wire] = toWire({ items: [meta({ deletedAt: '2026-03-01T00:00:00.000Z' })] });
    expect(wire.deleted_at).toBe('2026-03-01T00:00:00.000Z');
  });

  it('never sends device-local settings to the server', () => {
    // Theme and crew name belong to the phone, not the warehouse.
    const wire = toWire({ settings: [meta({ id: 'settings' })], items: [meta()] });
    expect(wire.map((row) => row.table_name)).toEqual(['items']);
  });

  it('handles an empty change set', () => {
    expect(toWire({})).toEqual([]);
  });

  it('rebuilds a change set from rows coming back', () => {
    const a = meta({ id: 'a' });
    const b = meta({ id: 'b' });
    const changes = fromWire([
      { table_name: 'items', data: a },
      { table_name: 'items', data: b },
      { table_name: 'events', data: meta({ id: 'e' }) },
    ]);

    expect(changes.items).toEqual([a, b]);
    expect(changes.events).toHaveLength(1);
  });

  it('survives a round trip unchanged', () => {
    const original = { items: [meta({ id: 'i1' })], events: [meta({ id: 'e1' })] };
    const round = fromWire(toWire(original).map((row) => ({ table_name: row.table_name, data: row.data })));
    expect(round).toEqual(original);
  });
});

describe('error messages', () => {
  it('explains the email rate limit, which the raw message does not', async () => {
    const { toSyncError } = await import('./supabase');
    const error = toSyncError('AuthApiError: email rate limit exceeded');

    expect(error.kind).toBe('auth');
    // The three things someone actually needs to know.
    expect(error.message).toMatch(/couple an hour/i);
    expect(error.message).toMatch(/whole project/i);
    expect(error.message).toMatch(/wait about an hour/i);
  });

  it('also catches the plain 429 wording', async () => {
    const { toSyncError } = await import('./supabase');
    expect(toSyncError('Too Many Requests').kind).toBe('auth');
  });

  it('keeps invite failures as auth problems', async () => {
    const { toSyncError } = await import('./supabase');
    expect(toSyncError('That invite has expired').kind).toBe('auth');
  });

  it('treats a missing membership as a permission problem', async () => {
    const { toSyncError } = await import('./supabase');
    expect(toSyncError('No access yet — ask an admin for an invite').kind).toBe('permission');
  });

  it('falls back to something readable for an empty error', async () => {
    const { toSyncError } = await import('./supabase');
    expect(toSyncError('').message).toMatch(/went wrong/i);
  });
});
