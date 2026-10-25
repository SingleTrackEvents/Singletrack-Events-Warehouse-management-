import { beforeEach, describe, expect, it } from 'vitest';
import { MockBackend, resetMockServer } from './mock';
import {
  accessPointingAt,
  defaultInviteExpiryDay,
  normaliseInviteCode,
  sameInviteCode,
  weekendSunday,
} from './types';
import type { Invite, Member } from './types';

describe('invite codes as typed', () => {
  it('puts back the spaces, case and dash a code loses over the radio', () => {
    expect(normaliseInviteCode('4q8k tp4l')).toBe('4Q8K-TP4L');
    expect(normaliseInviteCode('4Q8KTP4L')).toBe('4Q8K-TP4L');
    expect(normaliseInviteCode(' 4q8k-tp4l ')).toBe('4Q8K-TP4L');
  });

  it('passes an odd code on uppercased for the server to judge', () => {
    expect(normaliseInviteCode('crew-all')).toBe('CREW-ALL');
  });

  it('compares codes on their letters and digits', () => {
    expect(sameInviteCode('4Q8K-TP4L', '4q8k tp4l')).toBe(true);
    expect(sameInviteCode('4Q8K-TP4L', '4Q8K-TP4M')).toBe(false);
  });
});

describe('when a new invite stops', () => {
  it('lasts to the last day of the chosen event', () => {
    expect(defaultInviteExpiryDay({ startDate: '2026-11-14', endDate: '2026-11-15' }, '2026-10-25')).toBe('2026-11-15');
    expect(defaultInviteExpiryDay({ startDate: '2026-11-14', endDate: '' }, '2026-10-25')).toBe('2026-11-14');
  });

  it('gives a month with no event, or one already over', () => {
    expect(defaultInviteExpiryDay(undefined, '2026-10-25')).toBe('2026-11-24');
    expect(defaultInviteExpiryDay({ startDate: '2026-01-10', endDate: '2026-01-11' }, '2026-10-25')).toBe('2026-11-24');
  });

  it('means next Sunday when today is Sunday', () => {
    // 25 October 2026 is a Sunday.
    expect(weekendSunday('2026-10-25')).toBe('2026-11-01');
    expect(weekendSunday('2026-10-23')).toBe('2026-10-25');
    expect(weekendSunday('2026-10-31')).toBe('2026-11-01');
  });
});

describe('access pointing at a station', () => {
  const scope = { eventId: 'e1', destinationId: 'd1' };
  const invite = (over: Partial<Invite>): Invite => ({
    id: 'i', token: 'AAAA-BBBB', role: 'volunteer', scope, label: '', createdAt: '',
    expiresAt: null, revokedAt: null, usedCount: 0, ...over,
  });
  const member = (over: Partial<Member>): Member => ({
    userId: 'u', displayName: 'Tom', email: null, role: 'volunteer', scope, access: null,
    expiresAt: null, inviteId: null, createdAt: '', ...over,
  });

  it('counts live invites and people, not revoked or lapsed ones', () => {
    const now = Date.parse('2026-10-25T00:00:00Z');
    expect(
      accessPointingAt(
        'd1',
        [
          invite({}),
          invite({ revokedAt: '2026-10-01T00:00:00Z' }),
          invite({ expiresAt: '2026-10-01T00:00:00Z' }),
          invite({ scope: { eventId: 'e1', destinationId: 'd2' } }),
        ],
        [member({}), member({ expiresAt: '2026-10-01T00:00:00Z' })],
        now,
      ),
    ).toEqual({ invites: 1, members: 1 });
  });
});

describe('joining the demo server', () => {
  const backend = new MockBackend();

  beforeEach(async () => {
    await resetMockServer();
  });

  async function admin() {
    const challenge = await backend.signInWithEmail('jess@singletrack.test');
    return backend.completeEmailSignIn(challenge.devLink!);
  }

  it('takes a code typed without its dash', async () => {
    const session = await admin();
    const made = await backend.createInvite(session, {
      role: 'volunteer',
      scope: { eventId: 'e1', destinationId: 'd1' },
      label: 'Aid 1',
    });
    await backend.signOut();
    const joined = await backend.joinWithInvite(made.token.replace('-', ' ').toLowerCase(), 'Tom');
    expect(joined.scope).toEqual({ eventId: 'e1', destinationId: 'd1' });
  });

  it('says the code was not recognised when the demo has invites', async () => {
    const session = await admin();
    await backend.createInvite(session, { role: 'volunteer', scope: { eventId: 'e1', destinationId: 'd1' }, label: '' });
    await backend.signOut();
    await expect(backend.joinWithInvite('ZZZZ-ZZZZ', 'Tom')).rejects.toThrow(/not recognised/);
  });

  it('says it has no invites only when it has none', async () => {
    await expect(backend.joinWithInvite('ZZZZ-ZZZZ', 'Tom')).rejects.toThrow(/no invites on it/);
  });
});
