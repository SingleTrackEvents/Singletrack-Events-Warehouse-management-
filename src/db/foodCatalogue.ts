import type { Unit } from './types';

/**
 * Aid station food and drink.
 *
 * The equipment catalogue is generated from the consolidated inventory
 * spreadsheet, which carries no food — consumables lived in a separate
 * consumption planner sheet. This is that sheet's item list, maintained by
 * hand, with each item's measure carried over as its unit and pack size so the
 * food plan's ratios speak the same language the crew already used: cans of
 * coke, 6-packs of chips, 1 kg bags of lollies.
 *
 * `hold` follows the same rule as the generated catalogue: the largest
 * single-event requirement — here Wonderland's whole-event totals — becomes
 * the low-stock level. Quantities on hand stay at zero for the same reason as
 * everywhere else: the sheet is a plan, not a stocktake.
 */

export interface FoodCatalogueItem {
  name: string;
  sku: string;
  unit: Unit;
  /** Pieces per unit where the unit is a pack of countable things. */
  packSize: number;
  /** Largest single-event requirement, used as the reorder threshold. */
  hold: number;
  note: string;
}

export const FOOD_CATEGORY = { name: 'Aid Station Food & Drink', icon: '🍌' };

export const FOOD_CATALOGUE: FoodCatalogueItem[] = [
  { name: 'Water', sku: 'FD-01', unit: 'litre', packSize: 1, hold: 1815, note: 'Counted per litre' },
  { name: 'Ice', sku: 'FD-02', unit: 'bag', packSize: 1, hold: 0, note: '5 kg bag' },
  { name: 'Electrolyte', sku: 'FD-03', unit: 'pack', packSize: 1, hold: 47, note: '1 kg pack' },
  { name: 'Gels', sku: 'FD-04', unit: 'each', packSize: 1, hold: 600, note: '' },
  { name: 'Coke', sku: 'FD-05', unit: 'each', packSize: 1, hold: 501, note: '375 ml can' },
  { name: 'Bananas', sku: 'FD-06', unit: 'each', packSize: 1, hold: 184, note: 'Rayners box of 90' },
  { name: 'Oranges', sku: 'FD-07', unit: 'each', packSize: 1, hold: 103, note: 'Rayners box of 80' },
  { name: 'Watermelon', sku: 'FD-08', unit: 'each', packSize: 1, hold: 12, note: 'Whole melon' },
  { name: 'Salt', sku: 'FD-09', unit: 'each', packSize: 1, hold: 5, note: 'Shaker' },
  { name: 'Sugar', sku: 'FD-10', unit: 'kg', packSize: 1, hold: 5, note: '1 kg bag' },
  {
    name: 'Chips (SV + Plain)',
    sku: 'FD-11',
    unit: 'pack',
    packSize: 6,
    hold: 62,
    note: '6-pack, salt & vinegar and plain',
  },
  { name: 'Mars + Snickers', sku: 'FD-12', unit: 'pack', packSize: 20, hold: 30, note: '20-pack' },
  { name: 'Lollies', sku: 'FD-13', unit: 'kg', packSize: 1, hold: 23, note: '1 kg bag' },
  { name: 'Noodles', sku: 'FD-14', unit: 'each', packSize: 1, hold: 102, note: 'Cup' },
  { name: 'Noodles (GF)', sku: 'FD-15', unit: 'each', packSize: 1, hold: 12, note: 'Cup, gluten free' },
  {
    name: 'Hot Soup (Spring Veg)',
    sku: 'FD-16',
    unit: 'pack',
    packSize: 4,
    hold: 15,
    note: '4-pack sachets',
  },
  {
    name: 'Tea (English Breakfast)',
    sku: 'FD-17',
    unit: 'box',
    packSize: 100,
    hold: 2,
    note: 'Box of 100 bags',
  },
  { name: 'Coffee (Large Instant)', sku: 'FD-18', unit: 'each', packSize: 1, hold: 2, note: '200 g jar' },
  { name: 'Milo', sku: 'FD-19', unit: 'each', packSize: 1, hold: 2, note: '460 g tin' },
  { name: 'Cow Milk', sku: 'FD-20', unit: 'each', packSize: 1, hold: 2, note: '1 L carton' },
  { name: 'Soy Milk', sku: 'FD-21', unit: 'each', packSize: 1, hold: 2, note: '1 L carton' },
  { name: 'Donuts', sku: 'FD-22', unit: 'pack', packSize: 9, hold: 7, note: '9-pack' },
  { name: 'Ginger Beer', sku: 'FD-23', unit: 'each', packSize: 1, hold: 1406, note: '200 ml can' },
  {
    name: 'Boiled Potatoes',
    sku: 'FD-24',
    unit: 'each',
    packSize: 1,
    hold: 290,
    note: 'Medium potato, about 7 per kg',
  },
];
