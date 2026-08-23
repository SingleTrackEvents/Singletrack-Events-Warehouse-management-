import type { AccessType, DestinationType } from './types';

/**
 * Per-destination packing templates.
 *
 * The event templates generated from the spreadsheet are whole-event totals —
 * useful for checking a truck against the season, useless when you are standing
 * at Aid 3 with a crate. These are the other shape: what one station of a given
 * kind actually needs, so a packlist can be built per destination.
 *
 * Quantities are for one site and assume up to about 200 runners through it.
 * They are a starting point to adjust on the list itself, not a rule.
 *
 * Every SKU here must exist in the generated catalogue; a test enforces that, so
 * a rename in the spreadsheet breaks the build rather than silently dropping a
 * line from a packing list.
 *
 * Three things the old versions of these lists carried are absent, because the
 * warehouse inventory does not hold them:
 *
 *   * Food — gels, lollies, chips, soft drink, electrolyte powder. The
 *     spreadsheet is an equipment inventory; catering is bought per event.
 *   * UHF radios.
 *   * A defibrillator.
 *
 * Add them to the catalogue if the warehouse should be tracking them, and they
 * can be added to these lists at the same time. Inventing them here would have
 * put items on a packing list that no one can pick off a shelf.
 */

export interface StationTemplate {
  name: string;
  appliesTo: DestinationType;
  description: string;
  /**
   * Vehicle access this list is built for. Two aid-station templates exist and
   * the destination's own access field says which one fits, so the choice is
   * made from data rather than from whichever happens to be listed first.
   */
  suitsAccess?: AccessType[];
  /** [sku, quantity for one site, blocks "packed" while short] */
  lines: Array<[sku: string, qty: number, mandatory?: boolean]>;
}

export const STATION_TEMPLATES: StationTemplate[] = [
  {
    name: 'Standard aid station (up to 200 runners)',
    appliesTo: 'aid_station',
    suitsAccess: ['2wd'],
    description: 'The default vehicle-accessible station: water, shelter, serving kit, bins, safety.',
    lines: [
      ['WAT-01', 4, true],
      ['WAT-03', 1],
      ['SRV-05', 3],
      ['SRV-11', 1],
      ['SRV-06', 4],
      ['SRV-13', 4],
      ['SRV-14', 2],
      ['SRV-07', 4],
      ['SRV-08', 4],
      ['SRV-12', 1],
      ['SRV-10', 1],
      ['KIT-01', 1, true],
      ['STR-02', 1, true],
      ['STR-01', 2],
      ['ANC-03', 4, true],
      ['FRN-01', 2],
      ['FRN-03', 2],
      ['FRN-06', 2],
      ['HYG-07', 1, true],
      ['HYG-03', 1, true],
      ['HYG-05', 1],
      ['WST-01', 1],
      ['WST-02', 1, true],
      ['MED-04', 1, true],
      ['MED-06', 1, true],
      ['MED-01', 4, true],
      ['COM-02', 1],
      ['REG-02', 1],
      ['LGT-04', 1],
      ['VIL-10', 1],
      ['CRS-02', 4],
      ['SRV-15', 1, true],
      ['REG-07', 1],
    ],
  },
  {
    name: 'Remote station — 4WD / quad access',
    appliesTo: 'aid_station',
    suitsAccess: ['4wd', 'atv', 'foot', 'helicopter'],
    description:
      'Pared back to what fits on a quad, with the safety kit non-negotiable. Nobody is driving ' +
      'back out for a forgotten first aid kit.',
    lines: [
      ['WAT-01', 3, true],
      ['SRV-05', 2],
      ['SRV-06', 2],
      ['FRN-04', 1],
      ['FRN-01', 1],
      ['ANC-04', 2],
      ['HYG-07', 1, true],
      ['WST-02', 1, true],
      ['MED-04', 1, true],
      ['MED-06', 1, true],
      ['MED-01', 6, true],
      ['COM-01', 1, true],
      ['COM-02', 2, true],
      ['REG-20', 1, true],
      ['LGT-04', 1],
      ['SRV-15', 1, true],
    ],
  },
  {
    name: 'Event village core',
    appliesTo: 'event_village',
    description: 'Registration, finish line and bump-in kit for the village.',
    lines: [
      ['VIL-13', 1, true],
      ['VIL-09', 1, true],
      ['VIL-06', 4],
      ['VIL-01', 12],
      ['VIL-02', 6],
      ['VIL-04', 1],
      ['VIL-03', 2],
      ['VIL-15', 2],
      ['REG-06', 2, true],
      ['REG-21', 1, true],
      ['REG-01', 1, true],
      ['REG-22', 1, true],
      ['REG-12', 2],
      ['REG-14', 1],
      ['REG-15', 1],
      ['REG-10', 1],
      ['STR-02', 3, true],
      ['STR-01', 6],
      ['ANC-03', 12, true],
      ['FRN-01', 6],
      ['FRN-03', 6],
      ['FRN-02', 8],
      ['WST-01', 3],
      ['WST-02', 2],
      ['PWR-06', 1, true],
      ['PWR-11', 1, true],
      ['PWR-12', 3],
      ['PWR-04', 2],
      ['PWR-05', 4],
      ['LGT-01', 2],
      ['COM-01', 1, true],
      ['COM-04', 1],
      ['MED-04', 1, true],
      ['HYG-02', 2],
      ['HYG-03', 2],
      ['CRS-01', 10],
    ],
  },
  {
    name: 'Water-only drop',
    appliesTo: 'water_drop',
    description: 'Unstaffed cube drop with signage and a bin. Nothing here needs a person.',
    lines: [
      ['WAT-01', 3, true],
      ['SRV-05', 1],
      ['VIL-10', 1, true],
      ['WST-02', 1],
      ['CRS-09', 1],
      ['CRS-02', 2],
    ],
  },
];
