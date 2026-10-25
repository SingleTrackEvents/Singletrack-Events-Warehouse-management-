import { describe, expect, it } from 'vitest';
import type { PacklistLine } from '../db/types';
import {
  checkInFor,
  deliveryOf,
  describeCheckIn,
  describeWindow,
  formatLocalWhen,
  stationHours,
  whatsappLink,
} from './runSheet';

const line = (overrides: Partial<PacklistLine>): PacklistLine =>
  ({
    id: Math.random().toString(36),
    packlistId: 'p',
    itemId: 'i',
    qtyRequired: 4,
    qtyPacked: 4,
    deletedAt: null,
    syncedAt: null,
    ...overrides,
  }) as PacklistLine;

describe('run sheet', () => {
  it('reads local times as written', () => {
    expect(formatLocalWhen('2026-11-05T07:15')).toBe('Thu 5 Nov 07:15');
    expect(formatLocalWhen('2026-11-08')).toBe('Sun 8 Nov');
    expect(formatLocalWhen('')).toBe('');
  });

  it('describes a window, a same-day window and a start line', () => {
    expect(describeWindow({ label: 'Miler', firstRunner: '2026-11-06T09:26', cutoff: '2026-11-06T12:00' })).toBe(
      'Miler · Fri 6 Nov 09:26 to 12:00',
    );
    expect(describeWindow({ label: 'Miler', firstRunner: '2026-11-06T15:31', cutoff: '2026-11-07T02:15' })).toBe(
      'Miler · Fri 6 Nov 15:31 to Sat 7 Nov 02:15',
    );
    expect(describeWindow({ label: 'Miler start', firstRunner: '2026-11-06T08:00', cutoff: null })).toBe(
      'Miler start · Fri 6 Nov 08:00, start only',
    );
  });

  it('shows no hours rather than a guess', () => {
    expect(stationHours({ openTime: '', closeTime: '' })).toEqual([]);
    expect(stationHours({ openTime: '07:00', closeTime: '' })).toEqual(['07:00 to ?']);
  });

  it('makes WhatsApp links from Australian numbers', () => {
    expect(whatsappLink('0457 492 320')).toBe('https://wa.me/61457492320');
    expect(whatsappLink('+61 457 492 320')).toBe('https://wa.me/61457492320');
    expect(whatsappLink('ring Sarah')).toBeNull();
    expect(whatsappLink('')).toBeNull();
  });

  it('counts a short line as checked, so the job can end', () => {
    const lines = [line({ qtyReceived: 4 }), line({ qtyReceived: 2 }), line({ qtyReceived: 0 })];
    const checkIn = checkInFor(lines, (entry) => entry.qtyPacked);
    expect(checkIn).toMatchObject({ checked: 3, total: 3, short: 2, done: true });
    expect(describeCheckIn(checkIn)).toBe('3 of 3 checked · 2 short');
    expect(checkInFor([...lines, line({})], (entry) => entry.qtyPacked).done).toBe(false);
  });

  it('says where the answers are', () => {
    const unsent = [line({ qtyReceived: 4 })];
    const sent = [line({ qtyReceived: 4, syncedAt: '2026-11-05T08:00:00Z' })];
    expect(deliveryOf(unsent, { connected: false, sending: false })).toBe('phone-only');
    expect(deliveryOf(unsent, { connected: true, sending: true })).toBe('sending');
    expect(deliveryOf(unsent, { connected: true, sending: false })).toBe('waiting');
    expect(deliveryOf(sent, { connected: true, sending: false })).toBe('sent');
  });
});
