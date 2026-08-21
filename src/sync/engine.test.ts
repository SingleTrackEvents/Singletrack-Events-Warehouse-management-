import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, update } from '../db/repo';
import { applyRemote, collectOutbox, markAllDirty, pendingCount, resetCursor, runSync } from './engine';
import { MockBackend, mockServer, resetMockServer } from './mock';
import type { Session } from './types';
import { SyncError, UNSCOPED } from './types';

const backend = new MockBackend();

beforeEach(async () => {
  await resetMockServer();
  resetCursor();
});

async function makeItem(name: string, qtyOnHand = 5) {
  return create(db.items, {
    name, sku: name.toUpperCase(), categoryId: null, unit: 'each', packSize: 1, bin: 'A1',
    qtyOnHand, minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
  });
}

async function makeEventWithPacklist(suffix = '1') {
  const event = await create(db.events, {
    name: `Event ${suffix}`, location: 'Bright', startDate: '2026-04-04', endDate: '2026-04-04',
    status: 'packing', notes: '',
  });
  const destination = await create(db.destinations, {
    eventId: event.id, name: `Aid ${suffix}`, type: 'aid_station', courseKm: 8, access: '4wd',
    accessNotes: '', lat: null, lng: null, crewLead: '', phone: '', openTime: '06:00',
    closeTime: '11:00', notes: '', sort: 10,
  });
  const packlist = await create(db.packlists, {
    eventId: event.id, destinationId: destination.id, name: `Aid ${suffix}`, code: `A${suffix}-7K2M`,
    status: 'draft', packedBy: '', packedAt: null, deliveredAt: null, receivedBy: '', notes: '',
  });
  return { event, destination, packlist };
}

async function adminSession(): Promise<Session> {
  const challenge = await backend.signInWithEmail('jess@singletrack.test');
  return backend.completeEmailSignIn(challenge.devLink!);
}

describe('the outbox', () => {
  it('holds every locally written row until it is pushed', async () => {
    await makeItem('cubes');
    await makeItem('gels');
    expect(await pendingCount()).toBe(2);

    const outbox = await collectOutbox(null);
    expect(outbox.items).toHaveLength(2);
  });

  it('empties once a sync succeeds', async () => {
    await makeItem('cubes');
    const session = await adminSession();

    const stats = await runSync(backend, session);

    expect(stats.pushed).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it('re-fills when a synced row is edited again', async () => {
    const item = await makeItem('cubes');
    const session = await adminSession();
    await runSync(backend, session);
    expect(await pendingCount()).toBe(0);

    await update(db.items, item.id, { qtyOnHand: 9 });
    expect(await pendingCount()).toBe(1);
  });

  it('can be refilled deliberately after signing in on a device already in use', async () => {
    await makeItem('cubes');
    const session = await adminSession();
    await runSync(backend, session);

    const marked = await markAllDirty();

    expect(marked).toBeGreaterThan(0);
    expect(await pendingCount()).toBe(marked);
  });
});

describe('a full cycle', () => {
  it('lands local rows on the server', async () => {
    await makeItem('cubes', 12);
    await makeEventWithPacklist();
    const session = await adminSession();

    await runSync(backend, session);

    const stored = await mockServer.rows.toArray();
    expect(stored.some((entry) => entry.table === 'items')).toBe(true);
    expect(stored.some((entry) => entry.table === 'packlists')).toBe(true);
  });

  it('brings remote rows down onto the device', async () => {
    const session = await adminSession();
    // Something another device pushed earlier.
    await backend.push(session, {
      items: [{
        id: 'remote-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null, rev: 1, deviceId: 'other', syncedAt: null,
        name: 'Remote item', sku: 'REM', categoryId: null, unit: 'each', packSize: 1, bin: 'Z9',
        qtyOnHand: 3, minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
      } as never],
    });

    const stats = await runSync(backend, session);

    expect(stats.pulled).toBeGreaterThan(0);
    expect((await db.items.get('remote-1'))?.name).toBe('Remote item');
  });

  it('does not push rows straight back after pulling them', async () => {
    const session = await adminSession();
    await backend.push(session, {
      items: [{
        id: 'remote-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null, rev: 1, deviceId: 'other', syncedAt: null,
        name: 'Remote item', sku: 'REM', categoryId: null, unit: 'each', packSize: 1, bin: 'Z9',
        qtyOnHand: 3, minQty: 0, barcode: null, notes: '', consumable: false, archived: false,
      } as never],
    });

    await runSync(backend, session);

    expect(await pendingCount()).toBe(0);
  });

  it('still receives another device rows after pushing its own', async () => {
    // The two-phone case, which single-device tests never exercise: device A
    // has already put rows on the server, then device B signs in with local
    // work of its own and syncs. B must end up holding both.
    const session = await adminSession();
    await backend.push(session, {
      items: [{
        id: 'from-device-a', createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, rev: 1,
        deviceId: 'device-a', syncedAt: null,
        name: 'Packed by the other phone', sku: 'OTHER', categoryId: null, unit: 'each',
        packSize: 1, bin: 'A1', qtyOnHand: 3, minQty: 0, barcode: null, notes: '',
        consumable: false, archived: false,
      } as never],
    });

    // Device B's own local work, not yet on the server.
    await makeItem('made on device B');
    await runSync(backend, session);

    expect(await db.items.get('from-device-a')).toBeDefined();
    expect((await db.items.get('from-device-a'))!.name).toBe('Packed by the other phone');
  });

  it('carries a soft delete across so the removal replicates', async () => {
    const item = await makeItem('cubes');
    const session = await adminSession();
    await runSync(backend, session);

    await db.items.put({ ...(await db.items.get(item.id))!, deletedAt: '2026-02-01T00:00:00.000Z', rev: 9, syncedAt: null });
    await runSync(backend, session);

    const stored = await mockServer.rows.get(`items:${item.id}`);
    expect(stored?.row.deletedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('conflicts', () => {
  it('keeps the newer server copy and hands it back immediately', async () => {
    const item = await makeItem('cubes', 5);
    const session = await adminSession();
    await runSync(backend, session);

    // Another device gets further ahead than this one.
    await backend.push(session, {
      items: [
        { ...(await db.items.get(item.id))!, qtyOnHand: 99, rev: 50, updatedAt: '2030-01-01T00:00:00.000Z' } as never,
      ],
    });

    // This device makes a smaller local edit and syncs.
    await update(db.items, item.id, { qtyOnHand: 7 });
    const stats = await runSync(backend, session);

    expect(stats.stale).toBeGreaterThan(0);
    expect((await db.items.get(item.id))!.qtyOnHand).toBe(99);
  });

  it('accepts the local copy when it is the newer one', async () => {
    const item = await makeItem('cubes', 5);
    const session = await adminSession();
    await runSync(backend, session);

    await update(db.items, item.id, { qtyOnHand: 21 });
    await runSync(backend, session);

    expect((await mockServer.rows.get(`items:${item.id}`))!.row).toMatchObject({ qtyOnHand: 21 });
  });

  it('leaves a row edited mid-flight in the outbox rather than losing it', async () => {
    const item = await makeItem('cubes', 5);
    const session = await adminSession();
    const outbox = await collectOutbox(session);

    // Simulates the crew changing the number while the request is in flight.
    await update(db.items, item.id, { qtyOnHand: 8 });
    await backend.push(session, outbox);
    const { applied } = await applyRemote({});

    expect(applied).toBe(0);
    // The newer local edit must still be waiting, not silently marked as sent.
    expect(await pendingCount()).toBe(1);
    expect((await db.items.get(item.id))!.qtyOnHand).toBe(8);
  });
});

describe('offline', () => {
  it('queues rather than failing silently when there is no connection', async () => {
    await makeItem('cubes');
    const session = await adminSession();
    const online = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    await expect(runSync(backend, session)).rejects.toThrow(SyncError);
    expect(await pendingCount()).toBe(1);

    if (online) Object.defineProperty(navigator, 'onLine', online);
    else Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
});

describe('invites and volunteer access', () => {
  it('lets an admin invite a volunteer to one aid station', async () => {
    const admin = await adminSession();
    const { event, destination } = await makeEventWithPacklist();

    const invite = await backend.createInvite(admin, {
      role: 'volunteer',
      scope: { eventId: event.id, destinationId: destination.id },
      label: 'Aid 1 — Mystic Hill',
    });

    expect(invite.token).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(invite.expiresAt).not.toBeNull();
  });

  it('gives the volunteer a scoped session from just a name', async () => {
    const admin = await adminSession();
    const { event, destination } = await makeEventWithPacklist();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer',
      scope: { eventId: event.id, destinationId: destination.id },
      label: 'Aid 1',
    });

    const session = await backend.joinWithInvite(invite.token, 'Tom Reilly');

    expect(session.displayName).toBe('Tom Reilly');
    expect(session.role).toBe('volunteer');
    expect(session.guest).toBe(true);
    expect(session.email).toBeNull();
    expect(session.scope).toEqual({ eventId: event.id, destinationId: destination.id });
  });

  it('refuses a volunteer who tries to push stock', async () => {
    const admin = await adminSession();
    const { event, destination } = await makeEventWithPacklist();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: { eventId: event.id, destinationId: destination.id }, label: 'Aid 1',
    });
    const volunteer = await backend.joinWithInvite(invite.token, 'Tom');
    const item = await makeItem('cubes');

    const result = await backend.push(volunteer, { items: [(await db.items.get(item.id))!] });

    expect(result.accepted).toBe(0);
    expect(result.refused).toBe(1);
  });

  it('refuses a volunteer writing to another aid station', async () => {
    const admin = await adminSession();
    const first = await makeEventWithPacklist('1');
    const second = await makeEventWithPacklist('2');
    const invite = await backend.createInvite(admin, {
      role: 'volunteer',
      scope: { eventId: first.event.id, destinationId: first.destination.id },
      label: 'Aid 1',
    });
    const volunteer = await backend.joinWithInvite(invite.token, 'Tom');

    const result = await backend.push(volunteer, {
      packlists: [(await db.packlists.get(second.packlist.id))!],
    });

    expect(result.accepted).toBe(0);
    expect(result.refused).toBe(1);
  });

  it('accepts a volunteer writing to their own aid station', async () => {
    const admin = await adminSession();
    const { event, destination, packlist } = await makeEventWithPacklist();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: { eventId: event.id, destinationId: destination.id }, label: 'Aid 1',
    });
    const volunteer = await backend.joinWithInvite(invite.token, 'Tom');

    const result = await backend.push(volunteer, {
      packlists: [(await db.packlists.get(packlist.id))!],
    });

    expect(result.accepted).toBe(1);
    expect(result.refused).toBe(0);
  });

  it('never sends the stock catalogue down to a volunteer', async () => {
    const admin = await adminSession();
    const { event, destination } = await makeEventWithPacklist();
    await makeItem('cubes');
    await runSync(backend, admin);

    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: { eventId: event.id, destinationId: destination.id }, label: 'Aid 1',
    });
    const volunteer = await backend.joinWithInvite(invite.token, 'Tom');
    const pulled = await backend.pull(volunteer, null);

    expect(pulled.changes.items ?? []).toHaveLength(0);
    expect(pulled.changes.packlists ?? []).not.toHaveLength(0);
  });

  it('stops a revoked invite from being used', async () => {
    const admin = await adminSession();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: UNSCOPED, label: 'Anyone',
    });
    await backend.revokeInvite(admin, invite.id);

    await expect(backend.joinWithInvite(invite.token, 'Tom')).rejects.toThrow(/revoked/i);
  });

  it('stops an expired invite from being used', async () => {
    const admin = await adminSession();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: UNSCOPED, label: 'Anyone', expiresInDays: -1,
    });

    await expect(backend.joinWithInvite(invite.token, 'Tom')).rejects.toThrow(/expired/i);
  });

  it('will not let a volunteer invite anyone', async () => {
    const admin = await adminSession();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: UNSCOPED, label: 'Anyone',
    });
    const volunteer = await backend.joinWithInvite(invite.token, 'Tom');

    await expect(
      backend.createInvite(volunteer, { role: 'admin', scope: UNSCOPED, label: 'Sneaky' }),
    ).rejects.toThrow(/only an admin/i);
  });

  it('insists on a name so the crew know who recorded what', async () => {
    const admin = await adminSession();
    const invite = await backend.createInvite(admin, {
      role: 'volunteer', scope: UNSCOPED, label: 'Anyone',
    });

    await expect(backend.joinWithInvite(invite.token, '   ')).rejects.toThrow(/your name/i);
  });
});

describe('signing in with a code instead of a link', () => {
  it('accepts the code from the email', async () => {
    const challenge = await backend.signInWithEmail('jess@singletrack.test');
    const session = await backend.verifyEmailCode('jess@singletrack.test', challenge.devCode!);

    expect(session.email).toBe('jess@singletrack.test');
    expect(session.role).toBe('admin');
  });

  it('rejects the wrong code', async () => {
    await backend.signInWithEmail('jess@singletrack.test');
    await expect(backend.verifyEmailCode('jess@singletrack.test', '000000')).rejects.toThrow(
      /did not work/i,
    );
  });

  it('ignores spacing in a code someone has typed out', async () => {
    const challenge = await backend.signInWithEmail('jess@singletrack.test');
    const spaced = challenge.devCode!.replace(/(\d{3})(\d{3})/, '$1 $2');
    await expect(backend.verifyEmailCode('jess@singletrack.test', spaced)).resolves.toBeTruthy();
  });

  it('leaves the device signed in afterwards, as following a link would', async () => {
    const challenge = await backend.signInWithEmail('jess@singletrack.test');
    await backend.verifyEmailCode('jess@singletrack.test', challenge.devCode!);
    expect(await backend.currentSession()).not.toBeNull();
  });
});

describe('naming yourself', () => {
  it('guesses a sensible name from the email to start with', async () => {
    const challenge = await backend.signInWithEmail('jess.nolan@singletrack.test');
    const session = await backend.completeEmailSignIn(challenge.devLink!);
    expect(session.displayName).toBe('Jess Nolan');
  });

  it('lets someone correct the guess', async () => {
    await adminSession();
    const renamed = await backend.setDisplayName('Chad Freeman');

    expect(renamed.displayName).toBe('Chad Freeman');
    // And it sticks across a reload, since the crew see it on every packlist.
    expect((await backend.currentSession())!.displayName).toBe('Chad Freeman');
  });

  it('keeps the role and scope untouched when renaming', async () => {
    const before = await adminSession();
    const after = await backend.setDisplayName('Someone Else');

    expect(after.role).toBe(before.role);
    expect(after.scope).toEqual(before.scope);
    expect(after.userId).toBe(before.userId);
  });

  it('ignores an empty name rather than blanking the account', async () => {
    const before = await adminSession();
    const after = await backend.setDisplayName('   ');
    expect(after.displayName).toBe(before.displayName);
  });
});

describe('email sign-in', () => {
  it('rejects something that is not an email', async () => {
    await expect(backend.signInWithEmail('not-an-email')).rejects.toThrow(/email address/i);
  });

  it('signs in and stays signed in across a reload', async () => {
    const session = await adminSession();
    expect(session.role).toBe('admin');
    expect(await backend.currentSession()).toMatchObject({ userId: session.userId });
  });

  it('forgets the session on sign out', async () => {
    await adminSession();
    await backend.signOut();
    expect(await backend.currentSession()).toBeNull();
  });
});
