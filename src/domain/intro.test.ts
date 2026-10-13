import { describe, expect, it } from 'vitest';
import { hasSeenIntro, introFor, markIntroSeen } from './intro';
import { ROLES } from '../sync/types';
import type { Session } from '../sync/types';

describe('the welcome tour', () => {
  it('has a tour for every access level', () => {
    for (const role of ROLES) {
      const { steps } = introFor({ role } as Session);
      expect(steps.length, role).toBeGreaterThan(1);
      expect(steps.every((step) => step.title && step.body.length), role).toBe(true);
    }
  });

  it('keeps the warehouse out of the volunteer and driver tours', () => {
    for (const role of ['volunteer', 'driver'] as const) {
      const text = JSON.stringify(introFor({ role } as Session).steps);
      expect(text, role).not.toMatch(/Warehouse list|stocktake|New invite/);
    }
  });

  it('gives a phone with no account the full tour', () => {
    expect(introFor(null).role).toBe('admin');
  });

  it('shows once per role on a phone', () => {
    expect(hasSeenIntro('driver')).toBe(false);
    markIntroSeen('driver');
    expect(hasSeenIntro('driver')).toBe(true);
    expect(hasSeenIntro('crew')).toBe(false);
  });
});
