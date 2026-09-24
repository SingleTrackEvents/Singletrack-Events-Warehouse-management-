import { describe, expect, it } from 'vitest';
import {
  isQuantityHeading,
  matchCategory,
  matchDestination,
  matchItem,
  nameKey,
  similarity,
  tokens,
} from './importMatch';
import type { Category, Destination, Item } from '../db/types';

const META = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  rev: 1,
  deviceId: 'test',
  syncedAt: null,
};

function item(name: string, sku = '', extra: Partial<Item> = {}): Item {
  return {
    ...META,
    id: `item-${name}`,
    name,
    sku,
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: '',
    qtyOnHand: 0,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
    ...extra,
  };
}

function destination(name: string, type: Destination['type'] = 'aid_station'): Destination {
  return {
    ...META,
    id: `dest-${name}`,
    eventId: 'event',
    name,
    type,
    courseKm: null,
    access: '2wd',
    accessNotes: '',
    lat: null,
    lng: null,
    crewLead: '',
    phone: '',
    openTime: '',
    closeTime: '',
    notes: '',
    sort: 0,
  };
}

function category(name: string): Category {
  return { ...META, id: `cat-${name}`, name, sort: 0, icon: '📦' };
}

const CATALOGUE = [
  item('Trestle Tables', 'FRN-01'),
  item('Kettle - Electric', 'CKG-02'),
  item('Kettle - Stove Top', 'CKG-03'),
  item('Marquee - ST 3x3 (or equivalent)', 'STR-02'),
  item('Marquee Walls - 3x3 (or equivalent)', 'STR-01'),
  item('Hand Sanitiser', 'HYG-01'),
  item('Esky / Cooler', 'CLD-01'),
  item('Chairs - Camping / Folding', 'FRN-02'),
  item('Chairs - Plastic Bistro', 'FRN-03'),
  item('Gas Bottle', 'CKG-04'),
  item('Old Gazebo', 'STR-09', { archived: true }),
];

describe('tokens and keys', () => {
  it('drops case, punctuation, plurals and filler', () => {
    expect(tokens('Marquee Walls - 3x3 (or equivalent)')).toEqual(['marquee', 'wall', '3x3']);
    expect(nameKey('trestle table')).toBe(nameKey('Trestle Tables'));
    expect(nameKey('Kettle - Electric')).toBe(nameKey('electric kettle'));
  });

  it('reads the abbreviations people type on a pack list', () => {
    expect(tokens('Trestle tbls')).toEqual(['trestle', 'table']);
    expect(tokens('Ext lead 20m')).toEqual(['extension', 'lead', '20m']);
    expect(tokens('Gazebo')).toEqual(['marquee']);
  });
});

describe('similarity', () => {
  it('scores the same thing spelt two ways as near certain', () => {
    expect(similarity('Trestle table', 'Trestle Tables')).toBeGreaterThan(0.95);
    expect(similarity('Hand sanitizer', 'Hand Sanitiser')).toBeGreaterThan(0.9);
  });

  it('scores unrelated things low', () => {
    expect(similarity('Gas Bottle', 'Trestle Tables')).toBeLessThan(0.3);
  });

  it('is generous to a name contained in a longer one', () => {
    expect(similarity('Kettle', 'Kettle - Electric')).toBeGreaterThan(0.5);
  });
});

describe('matchItem', () => {
  it('matches an exact SKU or an exact normalised name as certain', () => {
    expect(matchItem('frn-01', CATALOGUE)).toMatchObject({ item: { sku: 'FRN-01' }, confidence: 'sure' });
    expect(matchItem('trestle table', CATALOGUE)).toMatchObject({ item: { name: 'Trestle Tables' }, confidence: 'sure' });
    expect(matchItem('Electric Kettle', CATALOGUE)).toMatchObject({ item: { name: 'Kettle - Electric' }, confidence: 'sure' });
  });

  it('offers a close spelling as a guess to be checked', () => {
    const match = matchItem('Hand sanitizer pump', CATALOGUE);
    expect(match?.item.name).toBe('Hand Sanitiser');
    expect(match?.confidence).toBe('likely');
  });

  it('prefers the variant the words point at', () => {
    expect(matchItem('Stove top kettle', CATALOGUE)?.item.name).toBe('Kettle - Stove Top');
    expect(matchItem('Bistro chairs', CATALOGUE)?.item.name).toBe('Chairs - Plastic Bistro');
    expect(matchItem('3x3 marquee walls', CATALOGUE)?.item.name).toBe('Marquee Walls - 3x3 (or equivalent)');
  });

  it('returns nothing for something the catalogue does not have', () => {
    expect(matchItem('Helicopter fuel drum', CATALOGUE)).toBeNull();
    expect(matchItem('', CATALOGUE)).toBeNull();
  });

  it('never offers an archived item', () => {
    expect(matchItem('Old Gazebo', CATALOGUE)).toBeNull();
  });
});

describe('matchDestination', () => {
  const stations = [
    destination('Allview Escape', 'event_village'),
    destination('Grand Canyon Carpark'),
    destination('Perrys Lookdown'),
    destination('Blue Gum Forest', 'checkpoint'),
    destination('Recovery Zone', 'finish'),
  ];

  it('finds a station from its name, abbreviated or not', () => {
    expect(matchDestination('Perrys', stations)?.destination.name).toBe('Perrys Lookdown');
    expect(matchDestination('Grand Canyon', stations)?.destination.name).toBe('Grand Canyon Carpark');
    expect(matchDestination('GC Carpark', stations)?.destination.name).toBe('Grand Canyon Carpark');
    expect(matchDestination('Blue Gum', stations)?.destination.name).toBe('Blue Gum Forest');
  });

  it('matches by initials and by shared station number', () => {
    expect(matchDestination('GCC', stations)?.destination.name).toBe('Grand Canyon Carpark');
    const numbered = [destination('Aid 1 — Bridge'), destination('Aid 2 — Ridge'), destination('Aid 3 — Plateau')];
    expect(matchDestination('AS3', numbered)?.destination.name).toBe('Aid 3 — Plateau');
    expect(matchDestination('Aid Station 2', numbered)?.destination.name).toBe('Aid 2 — Ridge');
  });

  it('uses a type word when the event has only one of that type', () => {
    expect(matchDestination('Village', stations)?.destination.name).toBe('Allview Escape');
    expect(matchDestination('Finish', stations)?.destination.name).toBe('Recovery Zone');
  });

  it('refuses spreadsheet furniture and unrelated headings', () => {
    expect(matchDestination('Total', stations)).toBeNull();
    expect(matchDestination('Qty', stations)).toBeNull();
    expect(matchDestination('Notes', stations)).toBeNull();
    expect(matchDestination('Mount Buller Summit', stations)).toBeNull();
  });
});

describe('headings', () => {
  it('knows a quantity column when it sees one', () => {
    expect(isQuantityHeading('Qty')).toBe(true);
    expect(isQuantityHeading('Quantity')).toBe(true);
    expect(isQuantityHeading('#')).toBe(true);
    expect(isQuantityHeading('Perrys')).toBe(false);
  });

  it('matches a numbered section heading to a category', () => {
    const categories = [category('Structure & Shelter'), category('Cooking & Heating')];
    expect(matchCategory('01. Structure & Shelter', categories)?.name).toBe('Structure & Shelter');
    expect(matchCategory('COOKING AND HEATING', categories)?.name).toBe('Cooking & Heating');
    expect(matchCategory('Cooking', categories)?.name).toBe('Cooking & Heating');
    expect(matchCategory('Trestle Tables', categories)).toBeNull();
  });
});
