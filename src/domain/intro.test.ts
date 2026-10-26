import { describe, expect, it } from 'vitest';
import { MAX_INTRO_STEPS, hasSeenIntro, introFor, introKind, markIntroSeen } from './intro';
import { ROLES } from '../sync/types';
import type { Session } from '../sync/types';

function session(role: Session['role'], extra: Partial<Session> = {}): Session {
  return { role, displayName: '', scope: { eventId: null, destinationId: null }, expiresAt: null, ...extra } as Session;
}

describe('the welcome tour', () => {
  it('has a short tour for every access level', () => {
    for (const role of ROLES) {
      const { steps } = introFor(session(role));
      expect(steps.length, role).toBeGreaterThan(1);
      expect(steps.length, role).toBeLessThanOrEqual(MAX_INTRO_STEPS);
      expect(steps.every((step) => step.title && step.body.length), role).toBe(true);
    }
  });

  it('picks the tour from what the person does', () => {
    expect(introKind(session('admin'))).toBe('admin');
    expect(introKind(session('crew'))).toBe('packer');
    expect(introKind(session('driver'))).toBe('driver');
    expect(introKind(session('volunteer', { scope: { eventId: 'e', destinationId: 'd' } }))).toBe('station');
  });

  it('gives crew kept to one station the station tour', () => {
    const pinned = session('crew', { scope: { eventId: 'e', destinationId: 'd' }, access: ['receive'] });
    expect(introKind(pinned)).toBe('station');
  });

  it('tells a volunteer about their list, ticking and Done', () => {
    const text = JSON.stringify(introFor(session('volunteer')).steps);
    expect(text).toMatch(/your station's list/);
    expect(text).toMatch(/Tick each item as it arrives/);
    expect(text).toMatch(/Tap Done when everything is checked/);
  });

  it('tells a packer to pick a station, tick and use the warehouse list', () => {
    const text = JSON.stringify(introFor(session('crew')).steps);
    expect(text).toMatch(/Pick a station/);
    expect(text).toMatch(/Tick items as you pack/);
    expect(text).toMatch(/warehouse list/);
  });

  it('tells an admin about events, packing lists and what is missing', () => {
    const text = JSON.stringify(introFor(session('admin')).steps);
    expect(text).toMatch(/event and its stations/);
    expect(text).toMatch(/packing list/);
    expect(text).toMatch(/What's missing/);
  });

  it('greets people by name, never by role', () => {
    expect(introFor(session('admin', { displayName: 'Chad Thompson' })).steps[0].title).toBe('Hi Chad');
    expect(introFor(null, 'Jess').steps[0].title).toBe('Hi Jess');
    expect(introFor(null).steps[0].title).toBe('Hi there');
    for (const role of ROLES) {
      expect(JSON.stringify(introFor(session(role)).steps), role).not.toMatch(/Welcome, admin/);
    }
  });

  it('keeps jargon out of every tour', () => {
    for (const role of ROLES) {
      const text = JSON.stringify(introFor(session(role)).steps);
      expect(text, role).not.toMatch(/Truck stage|Vans|Loaded|shed|stocktake|New invite/);
    }
  });

  it('keeps the warehouse out of the volunteer and driver tours', () => {
    for (const role of ['volunteer', 'driver'] as const) {
      const text = JSON.stringify(introFor(session(role)).steps);
      expect(text, role).not.toMatch(/warehouse list|stocktake|New invite/i);
    }
  });

  it('gives a device with no account the admin tour', () => {
    expect(introFor(null)).toMatchObject({ role: 'admin', kind: 'admin' });
  });

  it('shows once per role on a device', () => {
    expect(hasSeenIntro('driver')).toBe(false);
    markIntroSeen('driver');
    expect(hasSeenIntro('driver')).toBe(true);
    expect(hasSeenIntro('crew')).toBe(false);
  });
});
