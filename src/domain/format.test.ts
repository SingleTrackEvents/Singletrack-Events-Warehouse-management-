import { describe, expect, it } from 'vitest';
import { daysUntil, formatQty, formatQtyDetail, initials, plural, relativeDays } from './format';
import type { Item } from '../db/types';

describe('quantities', () => {
  it('drops the unit for plain countable things', () => {
    expect(formatQty(3, 'each')).toBe('3');
  });

  it('pluralises irregular units correctly', () => {
    expect(formatQty(1, 'box')).toBe('1 box');
    expect(formatQty(14, 'box')).toBe('14 boxes');
    expect(formatQty(2, 'carton')).toBe('2 ctns');
  });

  it('leaves measures alone', () => {
    expect(formatQty(40, 'litre')).toBe('40 L');
    expect(formatQty(1, 'kg')).toBe('1 kg');
    expect(formatQty(12, 'kg')).toBe('12 kg');
  });

  it('trims trailing zeros off fractional amounts', () => {
    expect(formatQty(2.5, 'kg')).toBe('2.5 kg');
    expect(formatQty(2.0, 'kg')).toBe('2 kg');
  });

  it('spells out the piece count for packed items', () => {
    const carton = { qtyOnHand: 14, packSize: 24, unit: 'box' } as Item;
    expect(formatQtyDetail(carton)).toBe('14 boxes · 336 ea');
  });

  it('leaves singles without a piece breakdown', () => {
    const single = { qtyOnHand: 4, packSize: 1, unit: 'each' } as Item;
    expect(formatQtyDetail(single)).toBe('4');
  });
});

describe('counts and names', () => {
  it('pluralises a counted noun', () => {
    expect(plural(1, 'crate')).toBe('1 crate');
    expect(plural(3, 'crate')).toBe('3 crates');
    expect(plural(2, 'discrepancy', 'discrepancies')).toBe('2 discrepancies');
  });

  it('takes at most two initials', () => {
    expect(initials('Dan Whitmore')).toBe('DW');
    expect(initials('Priya')).toBe('P');
    expect(initials('Mary Anne Van Der Berg')).toBe('MA');
  });
});

describe('dates', () => {
  const isoIn = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };

  it('counts days to an event', () => {
    expect(daysUntil(isoIn(0))).toBe(0);
    expect(daysUntil(isoIn(12))).toBe(12);
    expect(daysUntil(isoIn(-3))).toBe(-3);
  });

  it('says it plainly close to the day', () => {
    expect(relativeDays(isoIn(0))).toBe('today');
    expect(relativeDays(isoIn(1))).toBe('tomorrow');
    expect(relativeDays(isoIn(-1))).toBe('yesterday');
    expect(relativeDays(isoIn(5))).toBe('in 5 days');
  });

  it('switches to weeks once a race is far out', () => {
    expect(relativeDays(isoIn(28))).toBe('in 4 weeks');
    expect(relativeDays(isoIn(-28))).toBe('4 weeks ago');
  });
});
