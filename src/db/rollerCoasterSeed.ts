import type { HounslowPacklist } from './hounslowSeed';

/**
 * Roller Coaster Run 2026: starting packlists.
 *
 * From the RCR26 Aid Station Cards (v1.5): the Event Village pack list and
 * the station kit on each aid station card, translated onto the warehouse
 * catalogue by item name. Where the card pairs two things on one row
 * ("IBC and IBC pipe 2 / 2") they become two lines; where it splits one
 * catalogue item across rows (the Event Arch and the two ASICS arches) they
 * become one line with the split in the note.
 *
 * Seeded as drafts, like Hounslow: quantities to pack against, nothing packed.
 */

const WEIGHTS_NOTE = '1 per leg, 2 if windy';

export const RCR_PACKLISTS: HounslowPacklist[] = [
  {
    station: 'Kalorama Event Village',
    lines: [
      // Structure
      {
        item: 'Marquee - ST 3x3 (or equivalent)',
        qty: 15,
        note: 'Or 6x3 equivalent. Merch 6, recovery 2, 46k 1, massage 2, medical 1, drop bags 2, BOH and sound 2',
      },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 16 },
      { item: 'Weights - Steel 20kg', qty: 120, note: WEIGHTS_NOTE },
      { item: 'Ratchet Straps', qty: 60, note: '4 per marquee' },
      {
        item: 'Trestle Tables',
        qty: 23,
        note: 'Bib collection 5, merch 8, BOH and recovery BOH 4, recovery 4, medical 1, spare 2',
      },
      { item: 'Table Cloths', qty: 23, note: 'SingleTrack cloths, one per table' },
      { item: 'Tarps', qty: 6, note: 'Wet weather' },
      { item: 'Bins - Large Round Black', qty: 2 },
      // Power and lighting
      { item: 'Large Generator (Hired)', qty: 2, note: 'Run by the site crew' },
      { item: 'Jerry Can (Fuel)', qty: 1, note: 'Full' },
      { item: 'Electrical Power Cable (2-3m)', qty: 14 },
      { item: 'Extension Cable (5m+)', qty: 6 },
      { item: 'Extension Cable - 20m Heavy Duty', qty: 8 },
      { item: 'Extension Cable - 15 AMP', qty: 4 },
      { item: 'Power Board', qty: 6 },
      { item: 'Wet Weather Electrical Covers', qty: 6 },
      { item: 'Strip Light', qty: 10 },
      { item: 'Festoon Lighting (10m lengths)', qty: 10 },
      { item: 'Starlink', qty: 4 },
      // Arches, branding and course furniture
      { item: 'Inflatable Arch', qty: 3, note: '1 Event Arch, 2 ASICS Arches' },
      { item: 'Inflatable Pillar', qty: 2 },
      { item: 'Inflatable Arch Pump', qty: 2 },
      { item: 'Banners / Teardrop Banners / Sponsor Flags', qty: 18, note: 'CCB mesh banners (RCR)' },
      { item: 'Mesh Banner Toggles', qty: 12 },
      { item: 'PURE Flags', qty: 5 },
      { item: 'ASICS Marquee (3x3)', qty: 1 },
      { item: 'ASICS Umbrellas', qty: 6 },
      { item: 'Umbrella Bases', qty: 6 },
      { item: 'ASICS Vehicle', qty: 1 },
      { item: 'A-Frames (Village Instructions)', qty: 6 },
      { item: 'Track Mat / Carpet', qty: 34, note: 'All of it' },
      { item: 'Witches Hats / Cones', qty: 58 },
      // Village furniture and hire
      { item: 'Plastic Table & Chairs Set', qty: 20 },
      { item: 'Lounge Chairs', qty: 8 },
      { item: 'Picnic Blankets', qty: 10 },
      { item: 'Kids Table + Chair Set', qty: 1 },
      { item: 'PA System / VONYX + Mic + Stand', qty: 1, note: 'Hired, Albury Sound and Lighting' },
      { item: 'Coolroom / Coolroom Trailer', qty: 1 },
      { item: 'Portable Toilets', qty: 17, note: 'Hired' },
      { item: 'Toolbox', qty: 1, note: 'Hammer, scissors, tapes' },
      // Registration and merch: Tiffany packs medals, merch and laminating
      { item: 'Printer', qty: 1 },
      { item: 'Printer Ink', qty: 1, note: 'Spare pack' },
      { item: 'Paper (packs)', qty: 2 },
      { item: 'Registration Lists / Distance Signs', qty: 2, note: 'Printed with merch items' },
      { item: 'Safety Pins', qty: 3600 },
      { item: 'Merch - iPad & Square Reader', qty: 2, note: 'Square readers' },
      { item: 'Internet Dongle', qty: 1 },
      { item: 'Finisher Medals', qty: 1, note: 'All of them' },
      { item: 'Merchandise', qty: 1, note: 'All of it' },
      { item: 'Merch Racking (complete set)', qty: 1 },
      { item: 'PURE Retail Products', qty: 1, note: 'One lot' },
      // Village supplies, from black box stock
      { item: 'Toilet Paper', qty: 96 },
      { item: 'Sunscreen', qty: 10, note: 'Large pump' },
      { item: 'Hand Sanitiser', qty: 5, note: '4 × 50 ml + 1 large pump' },
      { item: 'Bin Bags (large / roll)', qty: 4 },
      { item: 'Cable Ties', qty: 5, note: 'Bags' },
      { item: 'Scissors / Snippers', qty: 5 },
    ],
  },
  {
    station: 'Kalorama Halfway and Finish Recovery',
    lines: [
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6, note: 'Marquees from the village build' },
      { item: 'Trestle Tables', qty: 6 },
      { item: 'Table Cloths', qty: 6 },
      { item: 'Esky / Cooler', qty: 2, note: 'For ice' },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'Hose & Fittings / Spray Nozzle', qty: 1 },
      { item: 'Electrical Power Cable (2-3m)', qty: 1 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
    ],
  },
  {
    station: 'Doongalla Picnic Grounds',
    lines: [
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 3 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Trestle Tables', qty: 6 },
      { item: 'Table Cloths', qty: 6 },
      { item: 'Chairs - Camping / Folding', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 24, note: WEIGHTS_NOTE },
      { item: 'Ratchet Straps', qty: 12 },
      { item: 'Tarps', qty: 2 },
      { item: 'Esky / Cooler', qty: 2, note: 'For ice' },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'IBC Water Container (1000L)', qty: 2 },
      { item: 'IBC Pipe', qty: 2 },
      { item: 'Starlink', qty: 1, note: 'Starlink Mini and battery' },
      { item: 'Bluetooth Speaker', qty: 1, note: 'Aid Station Manager brings' },
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
    ],
  },
  {
    station: 'Singleton Terrace',
    lines: [
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 4 },
      { item: 'Trestle Tables', qty: 3 },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Chairs - Camping / Folding', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 16, note: WEIGHTS_NOTE },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Tarps', qty: 2 },
      { item: 'Esky / Cooler', qty: 3 },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Generator', qty: 1 },
      { item: 'RCD (Portable Safety Switch)', qty: 1, note: 'Not on the v1.5 card: every generator gets one' },
      { item: 'Jerry Can (Fuel)', qty: 1, note: 'Full' },
      { item: 'Power Board', qty: 1 },
      { item: 'Electrical Power Cable (2-3m)', qty: 1 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Stand Light', qty: 1 },
      { item: 'Strip Light', qty: 1 },
      { item: 'Wet Weather Electrical Covers', qty: 1 },
      { item: 'Bluetooth Speaker', qty: 1, note: 'Aid Station Manager brings' },
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
    ],
  },
];
