import { describe, expect, it } from 'vitest';
import {
  can,
  canEditField,
  describeRole,
  inScope,
  isExpired,
  isStationOnly,
  roleAtLeast,
  scrubChanges,
  writableTables,
} from './permissions';
import type { Role, Session } from './types';
import { UNSCOPED } from './types';

const session = (role: Role, overrides: Partial<Session> = {}): Session => ({
  userId: 'u1',
  displayName: 'Test',
  email: role === 'volunteer' ? null : 'test@example.com',
  role,
  scope: UNSCOPED,
  token: 't',
  expiresAt: null,
  guest: role === 'volunteer',
  ...overrides,
});

describe('offline-only mode', () => {
  it('permits everything when nobody is signed in', () => {
    // The app must keep working exactly as it did before sync existed.
    expect(can(null, 'data:wipe')).toBe(true);
    expect(can(null, 'item:write')).toBe(true);
    expect(canEditField(null, 'packlistLines', 'qtyRequired')).toBe(true);
    expect(writableTables(null)).toBe('all');
  });
});

describe('admin', () => {
  it('can do everything, including managing people', () => {
    const admin = session('admin');
    for (const action of ['item:write', 'event:delete', 'member:manage', 'data:wipe'] as const) {
      expect(can(admin, action)).toBe(true);
    }
  });
});

describe('crew', () => {
  const crew = session('crew');

  it('runs the warehouse day to day', () => {
    expect(can(crew, 'item:write')).toBe(true);
    expect(can(crew, 'stock:adjust')).toBe(true);
    expect(can(crew, 'packlist:manage')).toBe(true);
    expect(can(crew, 'stocktake:manage')).toBe(true);
    expect(can(crew, 'load:manage')).toBe(true);
  });

  it('cannot manage people or destroy the catalogue', () => {
    expect(can(crew, 'member:manage')).toBe(false);
    expect(can(crew, 'data:wipe')).toBe(false);
    expect(can(crew, 'event:delete')).toBe(false);
    expect(can(crew, 'item:archive')).toBe(false);
  });
});

describe('driver', () => {
  const driver = session('driver');

  it('sees the run and confirms deliveries', () => {
    expect(can(driver, 'load:read')).toBe(true);
    expect(can(driver, 'load:deliver')).toBe(true);
    expect(can(driver, 'packlist:read')).toBe(true);
  });

  it('cannot change stock or rebuild packlists', () => {
    expect(can(driver, 'stock:adjust')).toBe(false);
    expect(can(driver, 'packlist:manage')).toBe(false);
    expect(can(driver, 'packlist:pack')).toBe(false);
    expect(can(driver, 'load:manage')).toBe(false);
  });
});

describe('volunteer', () => {
  const scoped = session('volunteer', {
    scope: { eventId: 'event-1', destinationId: 'dest-3' },
  });

  it('can read the event and record what arrived', () => {
    expect(can(scoped, 'event:read', { eventId: 'event-1' })).toBe(true);
    expect(can(scoped, 'packlist:receive', { eventId: 'event-1', destinationId: 'dest-3' })).toBe(true);
  });

  it('cannot reach another aid station', () => {
    expect(can(scoped, 'packlist:read', { eventId: 'event-1', destinationId: 'dest-9' })).toBe(false);
    expect(can(scoped, 'packlist:receive', { eventId: 'event-1', destinationId: 'dest-9' })).toBe(false);
  });

  it('cannot reach another event', () => {
    expect(can(scoped, 'event:read', { eventId: 'event-2' })).toBe(false);
  });

  it('cannot see the stock catalogue at all', () => {
    expect(can(scoped, 'item:read')).toBe(false);
    expect(can(scoped, 'stock:adjust')).toBe(false);
  });

  it('cannot pack, only receive', () => {
    expect(can(scoped, 'packlist:pack', { destinationId: 'dest-3' })).toBe(false);
    expect(can(scoped, 'packlist:manage', { destinationId: 'dest-3' })).toBe(false);
  });

  it('records what turned up without rewriting what was meant to be sent', () => {
    // Otherwise a short delivery could be made to look complete from the field.
    expect(canEditField(scoped, 'packlistLines', 'qtyReturned')).toBe(true);
    expect(canEditField(scoped, 'packlistLines', 'note')).toBe(true);
    expect(canEditField(scoped, 'packlistLines', 'qtyRequired')).toBe(false);
    expect(canEditField(scoped, 'packlistLines', 'qtyPacked')).toBe(false);
  });

  it('may only write the two tables its job touches', () => {
    expect(writableTables(scoped)).toEqual(['packlists', 'packlistLines']);
  });

  it('confirms what arrived on its own field, not the warehouse\'s', () => {
    expect(canEditField(scoped, 'packlistLines', 'qtyReceived')).toBe(true);
  });

  it('cannot move the packlist through its statuses', () => {
    // Where the crate is is the warehouse's and the driver's account of it.
    expect(canEditField(scoped, 'packlists', 'status')).toBe(false);
    expect(canEditField(scoped, 'packlists', 'notes')).toBe(true);
  });

  it('drops a forbidden change instead of half-applying it', () => {
    expect(
      scrubChanges(scoped, 'packlistLines', { qtyPacked: 9, qtyReceived: 3, note: 'wet' }),
    ).toEqual({ qtyReceived: 3, note: 'wet' });
  });
});

describe('scope matching', () => {
  it('treats a null scope as unrestricted', () => {
    expect(inScope(UNSCOPED, { eventId: 'anything', destinationId: 'anything' })).toBe(true);
  });

  it('ignores dimensions the target does not mention', () => {
    expect(inScope({ eventId: 'e1', destinationId: 'd1' }, { eventId: 'e1' })).toBe(true);
  });

  it('rejects a mismatch on either dimension', () => {
    expect(inScope({ eventId: 'e1', destinationId: null }, { eventId: 'e2' })).toBe(false);
    expect(inScope({ eventId: null, destinationId: 'd1' }, { destinationId: 'd2' })).toBe(false);
  });
});

describe('expiry', () => {
  const expired = session('crew', { expiresAt: '2020-01-01T00:00:00.000Z' });

  it('reports an elapsed session as expired', () => {
    expect(isExpired(expired)).toBe(true);
  });

  it('refuses every action once expired, whatever the role', () => {
    expect(can(expired, 'item:read')).toBe(false);
    expect(can(session('admin', { expiresAt: '2020-01-01T00:00:00.000Z' }), 'item:read')).toBe(false);
    expect(canEditField(expired, 'packlistLines', 'note')).toBe(false);
  });

  it('leaves sessions without an expiry alone', () => {
    expect(isExpired(session('crew'))).toBe(false);
  });

  it('treats a future expiry as still valid', () => {
    const future = session('volunteer', { expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(isExpired(future)).toBe(false);
    expect(can(future, 'packlist:read')).toBe(true);
  });
});

describe('role ordering', () => {
  it('ranks admin above crew above driver above volunteer', () => {
    expect(roleAtLeast('admin', 'crew')).toBe(true);
    expect(roleAtLeast('crew', 'crew')).toBe(true);
    expect(roleAtLeast('volunteer', 'crew')).toBe(false);
    expect(roleAtLeast('driver', 'volunteer')).toBe(true);
  });
});

describe('role descriptions', () => {
  it('describes each role in plain language for the access screen', () => {
    expect(describeRole('admin')).toContain('Invite people and set their access');
    expect(describeRole('volunteer')).toEqual(['Record what arrived on a packlist']);
    expect(describeRole('crew')).not.toContain('Invite people and set their access');
  });
});

describe('a volunteer pinned to one aid station', () => {
  const station = (over: Partial<Session> = {}): Session => ({
    userId: 'u1', displayName: 'Nigel', email: null, role: 'volunteer',
    scope: { eventId: 'event-1', destinationId: 'dest-3' },
    token: 't', expiresAt: null, guest: true,
    ...over,
  });

  it('is recognised as having one job', () => {
    expect(isStationOnly(station())).toBe(true);
    // An unscoped volunteer is not the same thing: nothing to send them to.
    expect(isStationOnly(station({ scope: { eventId: 'event-1', destinationId: null } }))).toBe(false);
    expect(isStationOnly(station({ role: 'crew' }))).toBe(false);
    expect(isStationOnly(null)).toBe(false);
  });

  it('reaches their own packlist and nothing beside it', () => {
    const who = station();
    expect(can(who, 'packlist:read', { eventId: 'event-1', destinationId: 'dest-3' })).toBe(true);
    expect(can(who, 'packlist:receive', { eventId: 'event-1', destinationId: 'dest-3' })).toBe(true);

    // The next station along is not theirs.
    expect(can(who, 'packlist:read', { eventId: 'event-1', destinationId: 'dest-4' })).toBe(false);
    // Nor is another race.
    expect(can(who, 'packlist:read', { eventId: 'event-2', destinationId: 'dest-3' })).toBe(false);
  });

  it('is refused every screen the tabs now hide', () => {
    const who = station();
    for (const action of [
      'item:read', 'item:write', 'stock:adjust',
      'load:read', 'load:manage', 'load:deliver',
      'stocktake:read', 'stocktake:manage', 'template:manage',
      'packlist:manage', 'packlist:pack',
      'member:manage', 'data:export', 'data:wipe',
      'event:write', 'event:delete',
    ] as const) {
      expect([action, can(who, action)]).toEqual([action, false]);
    }
  });

  it('may record what turned up but not rewrite what was sent', () => {
    const who = station();
    expect(canEditField(who, 'packlistLines', 'qtyReturned')).toBe(true);
    expect(canEditField(who, 'packlistLines', 'note')).toBe(true);
    // Otherwise a short delivery could be made to look complete from the field.
    expect(canEditField(who, 'packlistLines', 'qtyRequired')).toBe(false);
    expect(canEditField(who, 'packlistLines', 'qtyPacked')).toBe(false);
  });

  it('loses everything the moment the invite expires', () => {
    const done = station({ expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(can(done, 'packlist:read', { eventId: 'event-1', destinationId: 'dest-3' })).toBe(false);
    expect(canEditField(done, 'packlistLines', 'qtyReturned')).toBe(false);
  });
});
