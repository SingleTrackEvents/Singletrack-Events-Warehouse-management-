import { beforeEach, describe, expect, it } from 'vitest';
import { forgetSession, recallSession, rememberSession } from './sessionCache';
import type { Session } from './types';

const driver: Session = {
  userId: 'user-dee', displayName: 'Dee', email: null, role: 'driver',
  scope: { eventId: 'event-rcr', destinationId: null }, token: 'live-token', expiresAt: null, guest: true,
};

beforeEach(() => forgetSession());

describe('the remembered session', () => {
  it('comes back for the same account with the credential of the day', () => {
    rememberSession(driver);
    expect(recallSession('user-dee', 'fresh-token')).toEqual({ ...driver, token: 'fresh-token' });
  });

  it('never stores the credential itself', () => {
    rememberSession(driver);
    expect(localStorage.getItem('stw.sync.session')).not.toContain('live-token');
  });

  it('is nothing to a different account', () => {
    rememberSession(driver);
    expect(recallSession('user-someone-else', 'fresh-token')).toBeNull();
  });

  it('is gone after signing out', () => {
    rememberSession(driver);
    forgetSession();
    expect(recallSession('user-dee', 'fresh-token')).toBeNull();
  });
});
