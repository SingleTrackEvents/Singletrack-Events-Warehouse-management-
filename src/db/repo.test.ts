import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { create, update } from './repo';
import { setCurrentSession } from '../sync/current';
import type { Session } from '../sync/types';

/**
 * The last line of defence on this device.
 *
 * Every screen writes through `update()`, so this is where a change a role may
 * not make has to stop. If it got as far as the local database it would be
 * what this phone believes, and the next sync would carry it to everyone else.
 */

const station: Session = {
  token: 'tok',
  userId: 'user-1',
  displayName: 'Tom',
  email: null,
  guest: true,
  role: 'volunteer',
  scope: { eventId: 'event-1', destinationId: 'dest-3' },
  expiresAt: null,
};

async function makeLine() {
  return create(db.packlistLines, {
    packlistId: 'pl-1',
    itemId: 'item-1',
    qtyRequired: 4,
    qtyPacked: 4,
    qtyReturned: 0,
    mandatory: true,
    containerId: null,
    note: '',
    sort: 0,
  });
}

afterEach(() => setCurrentSession(null));

describe('update()', () => {
  it('lets an aid station record what turned up', async () => {
    setCurrentSession(station);
    const line = await makeLine();
    const next = await update(db.packlistLines, line.id, { qtyReceived: 3, note: 'one split' });
    expect(next).toMatchObject({ qtyReceived: 3, note: 'one split' });
  });

  it('drops what the role may not write and keeps the rest', async () => {
    setCurrentSession(null);
    const line = await makeLine();
    setCurrentSession(station);
    const next = await update(db.packlistLines, line.id, { qtyPacked: 1, qtyReceived: 1 });
    expect(next).toMatchObject({ qtyPacked: 4, qtyReceived: 1 });
  });

  it('does not touch the row at all when nothing in the change is permitted', async () => {
    setCurrentSession(null);
    const line = await makeLine();
    setCurrentSession(station);
    const next = await update(db.packlistLines, line.id, { qtyRequired: 99 });
    expect(next).toMatchObject({ qtyRequired: 4, rev: line.rev });
  });

  it('is unrestricted with no session, which is offline-only mode', async () => {
    setCurrentSession(null);
    const line = await makeLine();
    const next = await update(db.packlistLines, line.id, { qtyRequired: 9, qtyPacked: 9 });
    expect(next).toMatchObject({ qtyRequired: 9, qtyPacked: 9 });
  });
});
