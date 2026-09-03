import type { Unit } from './types';

/**
 * Items the warehouse carries that the generated inventory catalogue missed.
 *
 * These surfaced translating the Hounslow 2025 run sheets: real gear on real
 * load-outs with no catalogue row to land on. They file into the existing
 * generated categories, with SKUs numbered from 90 so a regenerated inventory
 * never collides with them — the importer numbers from 01 upwards.
 *
 * `hold` follows the house rule: the largest single-event requirement.
 */

export interface ExtraItem {
  name: string;
  sku: string;
  /** Existing category name from the generated catalogue. */
  category: string;
  unit: Unit;
  packSize: number;
  hold: number;
  consumable: boolean;
  note: string;
}

export const EXTRA_ITEMS: ExtraItem[] = [
  {
    name: 'Wet Weather Electrical Covers',
    sku: 'PWR-90',
    category: 'Power & Cabling',
    unit: 'each',
    packSize: 1,
    hold: 8,
    consumable: false,
    note: '',
  },
  {
    name: 'Bowls (eating)',
    sku: 'SRV-90',
    category: 'Serving & Catering',
    unit: 'each',
    packSize: 1,
    hold: 8,
    consumable: false,
    note: 'For runners — the serving bowls are a separate item',
  },
  {
    name: 'Forks (box)',
    sku: 'SRV-91',
    category: 'Serving & Catering',
    unit: 'box',
    packSize: 1,
    hold: 4,
    consumable: false,
    note: '',
  },
  {
    name: 'ASICS Marquee (3x3)',
    sku: 'VIL-90',
    category: 'Event Village & Branding',
    unit: 'each',
    packSize: 1,
    hold: 1,
    consumable: false,
    note: 'Sponsor marquee',
  },
  {
    name: 'Merch Racking (complete set)',
    sku: 'REG-90',
    category: 'Registration, Merch & Timing',
    unit: 'each',
    packSize: 1,
    hold: 1,
    consumable: false,
    note: 'Bring everything',
  },
  {
    name: 'Plastic Table & Chairs Set',
    sku: 'FRN-90',
    category: 'Furniture & Site Equipment',
    unit: 'each',
    packSize: 1,
    hold: 20,
    consumable: false,
    note: '',
  },
  {
    name: 'Zip Lock Bags (box)',
    sku: 'HYG-90',
    category: 'Hygiene & Consumables',
    unit: 'box',
    packSize: 1,
    hold: 7,
    consumable: true,
    note: 'One box per aid station kit',
  },
  {
    name: 'Kids Table + Chair Set',
    sku: 'FRN-91',
    category: 'Furniture & Site Equipment',
    unit: 'each',
    packSize: 1,
    hold: 1,
    consumable: false,
    note: 'Colin provides',
  },
];
