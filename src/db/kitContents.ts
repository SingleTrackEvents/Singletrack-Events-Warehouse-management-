/**
 * What goes in each kit, by catalogue item name.
 *
 * From the laminated contents list taped inside the Primary Aid Station Kit —
 * the one crews actually check the tubs against. Where the list names a
 * thing the catalogue splits or merges, the mapping follows the catalogue:
 * "Large Tupperware Container (With Lids)" is containers and lids, the two
 * hand sanitisers are one catalogue item, scissors and snippers likewise.
 *
 * Applied once, to a kit that has never had contents set. A kit the crew has
 * edited — even down to nothing — is theirs and is left alone.
 */

export interface KitSpec {
  /** Catalogue SKU of the kit item. */
  sku: string;
  /** [catalogue item name, quantity] per line. */
  contents: Array<[item: string, qty: number]>;
  /** Items taken out of the kit since earlier builds seeded it. */
  removed?: string[];
}

export const KIT_CONTENTS: KitSpec[] = [
  {
    sku: 'KIT-01', // Primary Aid Station Kit (3 x Black Tubs)
    // Sugar goes with the tea and coffee now, not in the box: it was not
    // getting used and kept spilling (Chad, 22 Oct 2026).
    removed: ['Sugar'],
    contents: [
      ['Chopping / Cutting Board', 2],
      ['Tupperware Containers', 4],
      ['Tupperware Lids', 4],
      ['Knives', 2],
      ['Serving Jugs (2L, marked)', 4],
      ['Paper Towel / Chux', 2],
      ['Bin Bags (large / roll)', 2],
      ['Electrolyte Measuring Cup', 1],
      ['Sunscreen', 1],
      ['Sanitiser Cleaning Spray (Spray & Wipe)', 1],
      ['Hand Sanitiser', 5], // 4 × 50 ml Dettol + 1 large pump
      ['Emergency Ponchos', 4],
      ['Female Sanitary Items', 1],
      ['Gaffa Tape', 1],
      ['Gloves', 1],
      ['Scissors / Snippers', 2], // scissors + snippers for cable ties
      ['Scrubbing Brush', 1],
      ['Serving Bowls', 2],
      ['Serving Platters', 2],
      ['Small Freezer Bags', 3], // medium 35 × 25 tie, 80-packs
      ['Zip Lock Bags (box)', 1],
      ['Sponges', 4],
      ['Stirring Spoon', 1],
      ['Tongs', 4],
      ['Matches', 1],
      ['Salt', 1],
      ['Aluminium Foil', 1],
      ['Cable Ties', 1],
      ['First Aid Kit', 1],
    ],
  },
  {
    // GPT100 2026 Master Pack List: the water point box at Coppermine and the
    // Mt Difficult ridgeline. Drinks only, so none of the food kit.
    sku: 'KIT-90', // Water Point Box
    contents: [
      ['Serving Jugs (2L, marked)', 4],
      ['Electrolyte Measuring Cup', 1],
      ['Jug - 500ml (Ice Water)', 2],
      ['Gloves', 1],
      ['Hand Sanitiser', 5],
      ['Sponges', 2],
      ['Sunscreen', 1],
      ['Cable Ties', 1],
      ['Scissors / Snippers', 2], // scissors + snippers for cable ties
      ['Small Freezer Bags', 3], // medium 35 × 25 tie, 80-packs
    ],
  },
];
