import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, softDelete, update } from '../db/repo';
import { exportAll, exportEvent, importBackup, isBackup, shouldReplace, wipeAll } from './backup';
import type { SyncMeta } from '../db/types';

async function makeItem(name: string, qtyOnHand = 5) {
  return create(db.items, {
    name,
    sku: name.toUpperCase(),
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

async function makeEventWithPacklist() {
  const event = await create(db.events, {
    name: 'Buffalo Stampede',
    location: 'Bright',
    startDate: '2026-04-04',
    endDate: '2026-04-04',
    status: 'packing',
    notes: '',
  });
  const destination = await create(db.destinations, {
    eventId: event.id,
    name: 'Aid 1',
    type: 'aid_station',
    courseKm: 8,
    access: '4wd',
    accessNotes: '',
    lat: null,
    lng: null,
    crewLead: '',
    phone: '',
    openTime: '06:00',
    closeTime: '11:00',
    notes: '',
    sort: 10,
  });
  const packlist = await create(db.packlists, {
    eventId: event.id,
    destinationId: destination.id,
    name: 'Aid 1',
    code: 'A1-7K2M',
    status: 'draft',
    packedBy: '',
    packedAt: null,
    deliveredAt: null,
    receivedBy: '',
    notes: '',
  });
  return { event, destination, packlist };
}

const meta = (overrides: Partial<SyncMeta>): SyncMeta =>
  ({
    id: 'x',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    deviceId: 'a',
    syncedAt: null,
    ...overrides,
  }) as SyncMeta;

describe('conflict resolution', () => {
  it('prefers the higher revision', () => {
    expect(shouldReplace(meta({ rev: 1 }), meta({ rev: 2 }))).toBe(true);
    expect(shouldReplace(meta({ rev: 3 }), meta({ rev: 2 }))).toBe(false);
  });

  it('breaks a revision tie on the later timestamp', () => {
    const older = meta({ rev: 2, updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = meta({ rev: 2, updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(shouldReplace(older, newer)).toBe(true);
    expect(shouldReplace(newer, older)).toBe(false);
  });
});

describe('validation', () => {
  it('recognises a backup envelope', async () => {
    expect(isBackup(await exportAll())).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isBackup(null)).toBe(false);
    expect(isBackup({ tables: {} })).toBe(false);
    expect(isBackup('{"format":"other"}')).toBe(false);
  });

  it('refuses to import a foreign file', async () => {
    await expect(importBackup({ format: 'nope' } as never)).rejects.toThrow(/not a warehouse backup/);
  });
});

describe('round trip', () => {
  it('restores everything onto an empty device', async () => {
    await makeItem('cubes', 12);
    const { packlist } = await makeEventWithPacklist();
    const backup = await exportAll();

    await wipeAll();
    expect(await db.items.count()).toBe(0);

    const result = await importBackup(backup);

    expect(await db.items.count()).toBe(1);
    expect((await db.packlists.get(packlist.id))!.code).toBe('A1-7K2M');
    expect(result.added).toBeGreaterThan(0);
    expect(result.updated).toBe(0);
  });

  it('carries tombstones across so deletes replicate', async () => {
    const item = await makeItem('cubes');
    await softDelete(db.items, item.id);
    const backup = await exportAll();

    await wipeAll();
    await importBackup(backup);

    expect((await db.items.get(item.id))!.deletedAt).not.toBeNull();
  });
});

describe('merging', () => {
  it('keeps newer local work when the imported copy is stale', async () => {
    const item = await makeItem('cubes', 5);
    const stale = await exportAll();

    await update(db.items, item.id, { qtyOnHand: 99 });
    const result = await importBackup(stale);

    expect((await db.items.get(item.id))!.qtyOnHand).toBe(99);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.updated).toBe(0);
  });

  it('takes the imported copy when it is newer', async () => {
    const item = await makeItem('cubes', 5);
    await update(db.items, item.id, { qtyOnHand: 42 });
    const fresh = await exportAll();

    await db.items.put({ ...item, qtyOnHand: 5 });
    const result = await importBackup(fresh);

    expect((await db.items.get(item.id))!.qtyOnHand).toBe(42);
    expect(result.updated).toBeGreaterThan(0);
  });

  it('replace mode overwrites regardless of revision', async () => {
    const item = await makeItem('cubes', 5);
    const stale = await exportAll();
    await update(db.items, item.id, { qtyOnHand: 99 });

    await importBackup(stale, 'replace');

    expect((await db.items.get(item.id))!.qtyOnHand).toBe(5);
  });
});

describe('event handover', () => {
  it('carries one event, its packlists and the catalogue they need', async () => {
    await makeItem('cubes');
    const { event, packlist } = await makeEventWithPacklist();
    const other = await create(db.events, {
      name: 'Hounslow Classic',
      location: 'NSW',
      startDate: '2026-10-10',
      endDate: '2026-10-10',
      status: 'planning',
      notes: '',
    });

    const backup = await exportEvent(event.id, 'Handover');

    expect(backup.eventId).toBe(event.id);
    expect(backup.tables.events?.map((row) => row.id)).toEqual([event.id]);
    expect(backup.tables.events?.map((row) => row.id)).not.toContain(other.id);
    expect(backup.tables.packlists?.map((row) => row.id)).toEqual([packlist.id]);
    expect(backup.tables.items).toHaveLength(1);
  });

  it('leaves out packlist lines belonging to other events', async () => {
    const item = await makeItem('cubes');
    const { event, packlist } = await makeEventWithPacklist();
    await create(db.packlistLines, {
      packlistId: packlist.id,
      itemId: item.id,
      qtyRequired: 4,
      qtyPacked: 0,
      qtyReturned: 0,
      mandatory: true,
      containerId: null,
      note: '',
      sort: 10,
    });
    await create(db.packlistLines, {
      packlistId: 'someone-elses-packlist',
      itemId: item.id,
      qtyRequired: 9,
      qtyPacked: 0,
      qtyReturned: 0,
      mandatory: false,
      containerId: null,
      note: '',
      sort: 10,
    });

    const backup = await exportEvent(event.id);

    expect(backup.tables.packlistLines).toHaveLength(1);
    expect(backup.tables.packlistLines?.[0].id).not.toBe('someone-elses-packlist');
  });
});
