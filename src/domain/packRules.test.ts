import { describe, expect, it } from 'vitest';
import { PACK_RULES, suggestionsFor } from './packRules';
import { CATALOGUE } from '../db/catalogue';
import { EXTRA_ITEMS } from '../db/extrasCatalogue';
import { FOOD_CATALOGUE } from '../db/foodCatalogue';
import { RCR_PACKLISTS } from '../db/rollerCoasterSeed';
import type { DestinationType, Item, PacklistLine } from '../db/types';

const catalogue = [
  ...CATALOGUE.flatMap((group) => group.items.map(({ name, sku, unit }) => ({ name, sku, unit }))),
  ...FOOD_CATALOGUE.map(({ name, sku, unit }) => ({ name, sku, unit })),
  ...EXTRA_ITEMS.map(({ name, sku, unit }) => ({ name, sku, unit })),
];

const items = new Map<string, Item>(
  catalogue.map(({ name, sku, unit }) => [
    sku,
    {
      id: sku, name, sku, unit, categoryId: null, packSize: 1, bin: '', qtyOnHand: 0, minQty: 0,
      barcode: null, notes: '', consumable: false, archived: false,
      createdAt: '', updatedAt: '', deletedAt: null, rev: 1, deviceId: '', syncedAt: null,
    } as Item,
  ]),
);
const skuOf = new Map(catalogue.map(({ name, sku }) => [name, sku]));

function list(entries: Array<[sku: string, qty: number]>): PacklistLine[] {
  return entries.map(([sku, qty], index) => ({
    id: `line-${index}`, packlistId: 'p', itemId: sku, qtyRequired: qty, qtyPacked: 0, qtyReturned: 0,
    mandatory: false, containerId: null, note: '', sort: index,
    createdAt: '', updatedAt: '', deletedAt: null, rev: 1, deviceId: '', syncedAt: null,
  }));
}

const asked = (lines: PacklistLine[], type: DestinationType) =>
  Object.fromEntries(suggestionsFor(lines, items, type).map((entry) => [entry.item.sku, entry.qty]));

describe('the pack rules', () => {
  it('name only SKUs the catalogue has', () => {
    const skus = new Set(catalogue.map((entry) => entry.sku));
    const named = PACK_RULES.flatMap((rule) => [
      ...('sku' in rule.when ? [rule.when.sku] : []),
      ...rule.add.map((companion) => companion.sku),
    ]);
    expect(named.filter((sku) => !skus.has(sku))).toEqual([]);
  });

  it('asks for straps, weights and walls with a marquee at an aid station', () => {
    expect(asked(list([['STR-02', 3]]), 'checkpoint')).toEqual({ 'ANC-01': 12, 'ANC-03': 12, 'STR-01': 6 });
  });

  it('leaves the village walls to the crew', () => {
    expect(asked(list([['STR-02', 15]]), 'event_village')).toEqual({ 'ANC-01': 60, 'ANC-03': 60 });
  });

  it('offers only the shortfall', () => {
    expect(asked(list([['STR-02', 2], ['ANC-01', 5], ['ANC-03', 16]]), 'checkpoint')).toEqual({
      'ANC-01': 3,
      'STR-01': 4,
    });
  });

  it('follows a chain: generator to power board to cover', () => {
    expect(asked(list([['PWR-06', 1]]), 'checkpoint')).toEqual({
      'PWR-91': 1, 'PWR-11': 1, 'PWR-04': 1, 'PWR-01': 1, 'PWR-10': 1, 'PWR-90': 1,
    });
  });

  it('takes a floor once, however many trigger it', () => {
    expect(asked(list([['VIL-13', 3], ['FRN-08', 2]]), 'event_village')).toEqual({ 'VIL-09': 1 });
  });

  it('gives every aid station its basics, and nowhere else', () => {
    expect(asked([], 'aid_station')).toEqual({ 'KIT-01': 1, 'WST-01': 2, 'FRN-06': 2, 'FRN-04': 2, 'COM-03': 1 });
    expect(asked([], 'event_village')).toEqual({});
  });

  it('gives a gas stove its bottle, lighter and two kettles, and a heater its own bottle', () => {
    expect(asked(list([['CKG-02', 1], ['CKG-07', 1]]), 'checkpoint')).toEqual({
      'CKG-01': 2, 'CKG-90': 1, 'CKG-03': 2,
    });
  });

  it('puts 5 blankets on every nap bed, and a pole and cone under every flag', () => {
    expect(asked(list([['MED-02', 2]]), 'checkpoint')).toEqual({ 'MED-01': 10 });
    expect(asked(list([['OTH-02', 25]]), 'start')).toEqual({ 'OTH-03': 25, 'CRS-90': 25 });
  });

  it('asks for a Starlink at GPT100 stations only', () => {
    const gpt = (type: DestinationType) =>
      Object.fromEntries(
        suggestionsFor([], items, type, 'stw-event-gpt26').map((entry) => [entry.item.sku, entry.qty]),
      );
    expect(gpt('finish')).toEqual({ 'COM-01': 1 });
    expect(gpt('aid_station')['COM-01']).toBe(1);
    expect(gpt('event_village')).toEqual({});
    expect(asked([], 'finish')).toEqual({});
  });

  it('finds nothing missing on the RCR26 cards, bar a cover for the recovery power board', () => {
    const types: Record<string, DestinationType> = {
      'Kalorama Event Village': 'event_village',
      'Kalorama Halfway and Finish Recovery': 'finish',
      'Doongalla Picnic Grounds': 'aid_station',
      'Singleton Terrace': 'aid_station',
    };
    const found = Object.fromEntries(
      RCR_PACKLISTS.map((spec) => [
        spec.station,
        asked(list(spec.lines.map((line) => [skuOf.get(line.item)!, line.qty])), types[spec.station]),
      ]),
    );
    expect(found).toEqual({
      'Kalorama Event Village': {},
      'Kalorama Halfway and Finish Recovery': { 'PWR-90': 1 },
      'Doongalla Picnic Grounds': {},
      'Singleton Terrace': {},
    });
  });
});
