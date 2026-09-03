import { describe, expect, it } from 'vitest';
import { parseSku, prefixForCategory, prefixFromName, suggestSku } from './skus';
import type { Category, Item } from '../db/types';

const META = {
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  rev: 1,
  deviceId: 'test',
  syncedAt: null,
};

function item(sku: string, categoryId: string | null, deletedAt: string | null = null): Item {
  return {
    ...META,
    id: `item-${sku}`,
    deletedAt,
    name: sku,
    sku,
    categoryId,
    unit: 'each',
    packSize: 1,
    bin: '',
    qtyOnHand: 0,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
  };
}

function category(id: string, name: string): Category {
  return { ...META, id, name, sort: 10, icon: '📦' };
}

describe('parseSku', () => {
  it('splits a catalogue code into prefix and number', () => {
    expect(parseSku('WAT-06')).toEqual({ prefix: 'WAT', number: 6 });
    expect(parseSku('fd-14')).toEqual({ prefix: 'FD', number: 14 });
  });

  it('ignores anything not in the scheme', () => {
    expect(parseSku('HYD-CUBE20')).toBeNull();
    expect(parseSku('')).toBeNull();
    expect(parseSku('12-34')).toBeNull();
  });
});

describe('prefixFromName', () => {
  it('reads like the codes the catalogue already uses', () => {
    expect(prefixFromName('Water & Ice')).toBe('WAT');
    expect(prefixFromName('Structure & Shelter')).toBe('STR');
    expect(prefixFromName('Registration, Merch & Timing')).toBe('REG');
    expect(prefixFromName('Lighting')).toBe('LIG');
  });

  it('borrows from the next word when the first is too short', () => {
    expect(prefixFromName('Ice Baths')).toBe('ICE');
    expect(prefixFromName('AV Kit Spares')).toBe('AVK');
  });

  it('falls back rather than coding nothing', () => {
    expect(prefixFromName('   ')).toBe('ITM');
  });
});

describe('prefixForCategory', () => {
  it('reads the prefix off the items already filed there', () => {
    const items = [item('WAT-01', 'water'), item('WAT-02', 'water'), item('STR-01', 'structure')];
    expect(prefixForCategory('water', items)).toBe('WAT');
  });

  it('keeps the commonest prefix when a stray code disagrees', () => {
    const items = [item('WAT-01', 'water'), item('WAT-02', 'water'), item('MSC-09', 'water')];
    expect(prefixForCategory('water', items)).toBe('WAT');
  });

  it('has nothing to go on for an empty category', () => {
    expect(prefixForCategory('empty', [item('WAT-01', 'water')])).toBeNull();
  });
});

describe('suggestSku', () => {
  const categories = [category('water', 'Water & Ice'), category('empty', 'Cold Chain')];

  it('suggests the next number on the category’s own prefix', () => {
    const items = [item('WAT-01', 'water'), item('WAT-09', 'water')];
    expect(suggestSku('water', categories, items)).toBe('WAT-10');
  });

  it('builds a prefix from the name when the category is empty', () => {
    expect(suggestSku('empty', categories, [])).toBe('COL-01');
    expect(suggestSku('water', categories, [])).toBe('WAT-01');
  });

  it('never reissues a deleted item’s code — its label is still out there', () => {
    const items = [item('WAT-01', 'water'), item('WAT-02', 'water', '2026-01-01T00:00:00.000Z')];
    expect(suggestSku('water', categories, items)).toBe('WAT-03');
  });

  it('looks across the whole catalogue, so a code means one thing', () => {
    // A WAT code filed under another category still blocks the number: a scan
    // has to resolve to exactly one item.
    const items = [item('WAT-01', 'water'), item('WAT-07', 'structure')];
    expect(suggestSku('water', categories, items)).toBe('WAT-08');
  });

  it('leaves the field alone when no category is chosen', () => {
    expect(suggestSku(null, categories, [])).toBe('');
    expect(suggestSku('gone', categories, [])).toBe('');
  });

  it('pads to two digits and keeps going past ninety-nine', () => {
    expect(suggestSku('water', categories, [item('WAT-04', 'water')])).toBe('WAT-05');
    expect(suggestSku('water', categories, [item('WAT-99', 'water')])).toBe('WAT-100');
  });
});
