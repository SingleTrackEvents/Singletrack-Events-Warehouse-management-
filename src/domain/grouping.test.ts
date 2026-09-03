import { describe, expect, it } from 'vitest';
import { categoryLabel, groupByCategory } from './grouping';
import type { Category } from '../db/types';

const META = {
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  rev: 1,
  deviceId: 'test',
  syncedAt: null,
};

function category(id: string, name: string, sort: number, icon = '📦'): Category {
  return { ...META, id, name, sort, icon };
}

interface Row {
  name: string;
  categoryId: string | null;
}

const CATEGORIES = [
  category('structure', 'Structure & Shelter', 10, '⛺'),
  category('water', 'Water & Ice', 20, '💧'),
  category('food', 'Food & Drink', 30, '🍌'),
];

const idOf = (row: Row) => row.categoryId;

describe('groupByCategory', () => {
  it('follows the catalogue’s order, not the alphabet', () => {
    const rows: Row[] = [
      { name: 'Bananas', categoryId: 'food' },
      { name: 'Marquee', categoryId: 'structure' },
      { name: 'Water cube', categoryId: 'water' },
    ];
    expect(groupByCategory(rows, idOf, CATEGORIES).map(([id]) => id)).toEqual([
      'structure',
      'water',
      'food',
    ]);
  });

  it('keeps each group in the order it was given', () => {
    // The caller has already sorted for the job at hand — bin order for the
    // picking pass — and grouping must not undo that.
    const rows: Row[] = [
      { name: 'Rack B', categoryId: 'water' },
      { name: 'Rack A', categoryId: 'water' },
    ];
    const [[, group]] = groupByCategory(rows, idOf, CATEGORIES);
    expect(group.map((row) => row.name)).toEqual(['Rack B', 'Rack A']);
  });

  it('puts uncategorised last, where it is not the first thing read', () => {
    const rows: Row[] = [
      { name: 'Odd sock', categoryId: null },
      { name: 'Marquee', categoryId: 'structure' },
    ];
    expect(groupByCategory(rows, idOf, CATEGORIES).map(([id]) => id)).toEqual([
      'structure',
      null,
    ]);
  });

  it('keeps a category it has never heard of above uncategorised', () => {
    const rows: Row[] = [
      { name: 'Mystery', categoryId: 'gone' },
      { name: 'Odd sock', categoryId: null },
      { name: 'Water cube', categoryId: 'water' },
    ];
    expect(groupByCategory(rows, idOf, CATEGORIES).map(([id]) => id)).toEqual([
      'water',
      'gone',
      null,
    ]);
  });

  it('groups nothing into nothing', () => {
    expect(groupByCategory([], idOf, CATEGORIES)).toEqual([]);
  });
});

describe('categoryLabel', () => {
  it('reads as its icon and name', () => {
    expect(categoryLabel('water', CATEGORIES)).toBe('💧 Water & Ice');
  });

  it('falls back for uncategorised and for one that has gone', () => {
    expect(categoryLabel(null, CATEGORIES)).toBe('📦 Uncategorised');
    expect(categoryLabel('gone', CATEGORIES)).toBe('📦 Uncategorised');
  });
});
