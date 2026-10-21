import { describe, expect, it } from 'vitest';
import { draftFrom, draftReady, grantOf } from './accessDraft';

describe('the access editor’s draft', () => {
  it('round-trips a customised grant', () => {
    const grant = {
      role: 'volunteer' as const,
      scope: { eventId: 'e1', destinationId: 'd1' },
      access: ['receive' as const, 'food' as const],
    };
    expect(grantOf(draftFrom(grant))).toEqual(grant);
  });

  it('saves a grant left at its role as the plain role', () => {
    const draft = draftFrom({ role: 'driver', scope: { eventId: 'e1', destinationId: null }, access: null });
    expect(grantOf(draft).access).toBeNull();
  });

  it('gives an admin every event and no boxes, whatever was picked before', () => {
    const draft = { ...draftFrom(null), eventId: 'e1', destinationId: 'd1', role: 'admin' as const };
    expect(grantOf(draft)).toEqual({ role: 'admin', scope: { eventId: null, destinationId: null }, access: null });
  });

  it('wants a station for a volunteer and an event for a driver', () => {
    expect(draftReady({ ...draftFrom(null), eventId: 'e1' })).toBe(false);
    expect(draftReady({ ...draftFrom(null), eventId: 'e1', destinationId: 'd1' })).toBe(true);
    expect(draftReady({ ...draftFrom(null), role: 'driver' })).toBe(false);
    expect(draftReady({ ...draftFrom(null), role: 'crew' })).toBe(true);
  });
});
