/**
 * Hounslow Classic 2026: starting packlists and food plan.
 *
 * Two sources, both the crew's own documents:
 *
 * `HOUNSLOW_PACKLISTS` is the 2025 Aid Station Run Sheets (vFinal) — the
 * equipment matrix for the five service points, translated onto the warehouse
 * catalogue by item name. Quantities are last year's plan, seeded as required
 * amounts on draft packlists for this year's stations to be corrected from.
 *
 * `HOUNSLOW_CONSUMPTION` is the HC 2026 consumption planner. The sheet keys
 * ratios per race per station; the app keys one rule per station, so each
 * per-runner figure here is derived as (the sheet's combined Sat+Sun total for
 * that station) ÷ (runners through it at the sheet's projections: Marathon 450,
 * 17k 612, Kids 80). At those projections every computed quantity reproduces
 * the sheet's total exactly; move a projection and the plan scales with it.
 */

export interface HounslowPackLine {
  /** Exact catalogue item name — a test keeps these honest. */
  item: string;
  qty: number;
  note?: string;
}

export interface HounslowPacklist {
  /** Destination name, matching the hc26 entry in eventSeed.ts. */
  station: string;
  lines: HounslowPackLine[];
}

const SANITISER = { item: 'Hand Sanitiser', qty: 5, note: '4 × 50 ml Dettol + 1 large pump' };
const SNIPS = { item: 'Scissors / Snippers', qty: 3, note: '2 scissors + 1 snips' };
const SPEAKER = { item: 'Bluetooth Speaker', qty: 1, note: 'Aid Station Team Leader to provide' };

/** The black-box kit every staffed station carried in 2025. */
const STATION_KIT: HounslowPackLine[] = [
  { item: 'Aluminium Foil', qty: 2 },
  { item: 'Bowls (eating)', qty: 2 },
  { item: 'Forks (box)', qty: 1 },
  { item: 'Cable Ties', qty: 2 },
  { item: 'Chopping / Cutting Board', qty: 2 },
  { item: 'Emergency Ponchos', qty: 1 },
  { item: 'Female Sanitary Items', qty: 1 },
  { item: 'First Aid Kit', qty: 1 },
  { item: 'Gaffa Tape', qty: 1 },
  { item: 'Gloves', qty: 1 },
  SANITISER,
  { item: 'Knives', qty: 2 },
  { item: 'Bin Bags (large / roll)', qty: 2 },
  { item: 'Electrolyte Measuring Cup', qty: 2 },
  { item: 'Sanitiser Cleaning Spray (Spray & Wipe)', qty: 1 },
  SNIPS,
  { item: 'Scrubbing Brush', qty: 1 },
  { item: 'Serving Bowls', qty: 2 },
  { item: 'Serving Platters', qty: 2 },
  { item: 'Small Freezer Bags', qty: 10 },
  { item: 'Sponges', qty: 4 },
  { item: 'Stirring Spoon', qty: 1 },
  { item: 'Sunscreen', qty: 4 },
  { item: 'Tongs', qty: 4 },
  { item: 'Tupperware Containers', qty: 4 },
  { item: 'Tupperware Lids', qty: 4 },
];

/** The hot-food setup Perrys and the Pinnacles both ran in 2025. */
const HOT_FOOD_KIT: HounslowPackLine[] = [
  { item: 'Toastie / Jaffle Maker', qty: 1 },
  { item: 'Kettle - Electric', qty: 1 },
  { item: 'Electric Hot Water Urn', qty: 1 },
  { item: 'Gas Bottle', qty: 1 },
  { item: 'Gas Heater', qty: 1 },
  { item: 'Gas Stove', qty: 1 },
  { item: 'Kettle - Stove Top', qty: 1 },
  { item: 'Insulated Hot Cups', qty: 1, note: 'Box of 500' },
  { item: 'Matches', qty: 1 },
  { item: 'Milo', qty: 1 },
  { item: 'Sporks / Cutlery', qty: 4, note: '4 packs of 50' },
];

export const HOUNSLOW_PACKLISTS: HounslowPacklist[] = [
  {
    station: 'Recovery Zone',
    lines: [
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Hammer / Mallet', qty: 1 },
      { item: 'Hose & Fittings / Spray Nozzle', qty: 1 },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'Pegs - Large', qty: 8 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Pegs - Small', qty: 8 },
      { item: 'Trestle Tables', qty: 4 },
      { item: 'Electrical Power Cable (2-3m)', qty: 1 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Electric Hot Water Urn', qty: 1 },
      { item: 'Gas Bottle', qty: 1 },
      { item: 'Gas Heater', qty: 1 },
      { item: 'Matches', qty: 1 },
      { item: 'Milo', qty: 1 },
      { item: 'Serving Jugs (2L, marked)', qty: 3 },
      { item: 'Paper Towel / Chux', qty: 2 },
      ...STATION_KIT,
    ],
  },
  {
    station: 'Grand Canyon Carpark',
    lines: [
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 4 },
      { item: 'Chairs - Camping / Folding', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Sandbags', qty: 16 },
      { item: 'Tarps', qty: 2 },
      { item: 'Trestle Tables', qty: 4 },
      { item: 'Generator', qty: 1, note: 'Hire 2 generators across the event' },
      SPEAKER,
      { item: 'Serving Jugs (2L, marked)', qty: 3 },
      { item: 'Paper Towel / Chux', qty: 2 },
      { item: 'Toilet Paper', qty: 24, note: 'Public toilet on site' },
      ...STATION_KIT,
    ],
  },
  {
    station: 'Perrys Lookdown',
    lines: [
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 4 },
      { item: 'Chairs - Camping / Folding', qty: 2 },
      { item: 'Chairs - Plastic Bistro', qty: 6 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Esky / Cooler', qty: 3 },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Sandbags', qty: 16 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 1 },
      { item: 'Tarps', qty: 2 },
      { item: 'Trestle Tables', qty: 3 },
      { item: 'Electrical Power Cable (2-3m)', qty: 1 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Generator', qty: 1 },
      { item: 'Jerry Can (Fuel)', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Stand Light', qty: 1 },
      { item: 'Starlink', qty: 1 },
      { item: 'Strip Light', qty: 1 },
      { item: 'Wet Weather Electrical Covers', qty: 1 },
      ...HOT_FOOD_KIT,
      SPEAKER,
      { item: 'Serving Jugs (2L, marked)', qty: 4 },
      { item: 'Paper Towel / Chux', qty: 4 },
      { item: 'Toilet Paper', qty: 24 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'Portable Toilets', qty: 1 },
      ...STATION_KIT,
    ],
  },
  {
    station: 'The Pinnacles Car Park',
    lines: [
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 3 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 7 },
      { item: 'Chairs - Camping / Folding', qty: 2 },
      { item: 'Chairs - Plastic Bistro', qty: 6 },
      { item: 'Weights - Steel 20kg', qty: 12 },
      { item: 'Esky / Cooler', qty: 4 },
      { item: 'Hammer / Mallet', qty: 1 },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'Ratchet Straps', qty: 12 },
      { item: 'Sandbags', qty: 20 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 1 },
      { item: 'Tarps', qty: 2 },
      { item: 'Trestle Tables', qty: 4 },
      { item: 'Electrical Power Cable (2-3m)', qty: 1 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Generator', qty: 1 },
      { item: 'Jerry Can (Fuel)', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Starlink', qty: 1 },
      { item: 'Wet Weather Electrical Covers', qty: 1 },
      ...HOT_FOOD_KIT,
      SPEAKER,
      { item: 'Serving Jugs (2L, marked)', qty: 4 },
      { item: 'Paper Towel / Chux', qty: 4 },
      { item: 'Toilet Paper', qty: 48 },
      { item: 'IBC Pipe', qty: 2 },
      { item: 'IBC Water Container (1000L)', qty: 2 },
      { item: 'Portable Toilets', qty: 1 },
      ...STATION_KIT,
    ],
  },
  {
    station: 'Allview Escape',
    lines: [
      {
        item: 'Marquee - ST 3x3 (or equivalent)',
        qty: 11,
        note: 'Medical 1 (Lucas brings 1) · bibs 3 · merch 4 · BOH/sound 2 · info 1',
      },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 12 },
      { item: 'Hammer / Mallet', qty: 2 },
      { item: 'Bins - Large Round Black', qty: 2 },
      { item: 'Pegs - Large', qty: 44 },
      { item: 'Ratchet Straps', qty: 44 },
      { item: 'Trestle Tables', qty: 17, note: 'Rego 7 · merch 4 · BOH 4 · spare 2' },
      { item: 'Electrical Power Cable (2-3m)', qty: 14 },
      { item: 'Extension Cable (5m+)', qty: 6 },
      { item: 'Generator', qty: 1 },
      { item: 'Jerry Can (Fuel)', qty: 1 },
      { item: 'Power Board', qty: 6 },
      { item: 'Starlink', qty: 4 },
      { item: 'Strip Light', qty: 10 },
      { item: 'Wet Weather Electrical Covers', qty: 6 },
      { item: 'Coffee (Large Instant)', qty: 5 },
      { item: 'Tea (English Breakfast)', qty: 5 },
      { item: 'Gas Bottle', qty: 2 },
      { item: 'Gas Heater', qty: 2 },
      { item: 'Insulated Hot Cups', qty: 2, note: 'Boxes of 500' },
      { item: 'Matches', qty: 1 },
      { item: 'Cable Ties', qty: 5 },
      SANITISER,
      { item: 'Bin Bags (large / roll)', qty: 4 },
      { item: 'Scissors / Snippers', qty: 5 },
      { item: 'Sunscreen', qty: 10 },
      { item: 'Toilet Paper', qty: 96 },
      { item: 'Coolroom / Coolroom Trailer', qty: 1, note: '1 × Adrian + 1 order' },
      { item: 'Portable Toilets', qty: 10 },
      { item: 'A-Frames (Village Instructions)', qty: 6 },
      { item: 'ASICS Umbrellas', qty: 6 },
      { item: 'ASICS Vehicle', qty: 1 },
      { item: 'Banners / Teardrop Banners / Sponsor Flags', qty: 18, note: 'CCB mesh banners' },
      { item: 'Crowd Barriers', qty: 6, note: 'Sets of 3' },
      { item: 'Extension Cable - 15 AMP', qty: 2 },
      { item: 'Power Electrical Cable (20m+)', qty: 8 },
      { item: 'Festoon Lighting (10m lengths)', qty: 10 },
      { item: 'Inflatable Arch Pump', qty: 2 },
      { item: 'Inflatable Arch', qty: 3, note: '2 × ASICS + 1 × event' },
      { item: 'Inflatable Pillar', qty: 2 },
      { item: 'Lounge Chairs', qty: 8 },
      { item: 'Mesh Banner Toggles', qty: 12 },
      { item: 'PA System / VONYX + Mic + Stand', qty: 1, note: 'Hired from Albury Sound & Lighting' },
      { item: 'Picket Fence', qty: 20 },
      { item: 'Picnic Blankets', qty: 10 },
      { item: 'International / Participant / Presentation Flags', qty: 5, note: 'Pure flags' },
      { item: 'Track Mat / Carpet', qty: 34 },
      { item: 'Umbrella Bases', qty: 6 },
      { item: 'Witches Hats / Cones', qty: 58 },
      { item: 'Internet Dongle', qty: 1 },
      { item: 'Finisher Medals', qty: 1 },
      { item: 'Merchandise', qty: 1 },
      { item: 'Paper (packs)', qty: 2 },
      { item: 'Printer', qty: 1 },
      { item: 'Printer Ink', qty: 1 },
      { item: 'Registration Lists / Distance Signs', qty: 2 },
      { item: 'Safety Pins', qty: 36, note: '3,600 pins — packs of 100' },
      { item: 'Merch - iPad & Square Reader', qty: 2 },
      { item: 'ASICS Marquee (3x3)', qty: 1 },
      { item: 'Merch Racking (complete set)', qty: 1, note: 'Bring everything' },
      { item: 'Plastic Table & Chairs Set', qty: 20 },
      { item: 'Kids Table + Chair Set', qty: 1, note: 'Colin to provide' },
    ],
  },
];

export interface HounslowFoodLine {
  station: string;
  /** Food catalogue SKU. */
  sku: string;
  perRunner: number;
  flatQty: number;
}

/*
 * Derived from the sheet's per-station totals. Runners through each station at
 * the sheet's projections: Grand Canyon 1062, Allview 1592, Perrys 900,
 * Blue Gum 450, Pinnacles 450. Ratios are rounded up at the sixth decimal so
 * the computed quantity never falls below the sheet's figure.
 */
export const HOUNSLOW_CONSUMPTION: HounslowFoodLine[] = [
  { station: 'Grand Canyon Carpark', sku: 'FD-01', perRunner: 1.031074, flatQty: 0 }, // 1095
  { station: 'Grand Canyon Carpark', sku: 'FD-02', perRunner: 0.020716, flatQty: 0 }, // 22
  { station: 'Grand Canyon Carpark', sku: 'FD-03', perRunner: 0.012242, flatQty: 0 }, // 13
  { station: 'Grand Canyon Carpark', sku: 'FD-04', perRunner: 0.800377, flatQty: 0 }, // 850
  { station: 'Grand Canyon Carpark', sku: 'FD-05', perRunner: 0.232581, flatQty: 0 }, // 247
  { station: 'Grand Canyon Carpark', sku: 'FD-23', perRunner: 0.215631, flatQty: 0 }, // 229
  { station: 'Grand Canyon Carpark', sku: 'FD-06', perRunner: 0.118645, flatQty: 0 }, // 126
  { station: 'Grand Canyon Carpark', sku: 'FD-07', perRunner: 0.059323, flatQty: 0 }, // 63
  { station: 'Grand Canyon Carpark', sku: 'FD-08', perRunner: 0.007533, flatQty: 0 }, // 8
  { station: 'Grand Canyon Carpark', sku: 'FD-11', perRunner: 0.032016, flatQty: 0 }, // 34
  { station: 'Grand Canyon Carpark', sku: 'FD-12', perRunner: 0.010358, flatQty: 0 }, // 11
  { station: 'Grand Canyon Carpark', sku: 'FD-13', perRunner: 0.006592, flatQty: 0 }, // 7
  { station: 'Grand Canyon Carpark', sku: 'FD-24', perRunner: 0.021658, flatQty: 0 }, // 23
  { station: 'Grand Canyon Carpark', sku: 'FD-09', perRunner: 0, flatQty: 1 },
  { station: 'Grand Canyon Carpark', sku: 'FD-10', perRunner: 0, flatQty: 1 },
  { station: 'Allview Escape', sku: 'FD-01', perRunner: 1.949749, flatQty: 0 }, // 3104
  { station: 'Allview Escape', sku: 'FD-02', perRunner: 0.078518, flatQty: 0 }, // 125
  { station: 'Allview Escape', sku: 'FD-03', perRunner: 0.014448, flatQty: 0 }, // 23
  { station: 'Allview Escape', sku: 'FD-04', perRunner: 0.226131, flatQty: 0 }, // 360
  { station: 'Allview Escape', sku: 'FD-05', perRunner: 0.444096, flatQty: 0 }, // 707
  { station: 'Allview Escape', sku: 'FD-23', perRunner: 0.428392, flatQty: 0 }, // 682
  { station: 'Allview Escape', sku: 'FD-06', perRunner: 0.162061, flatQty: 0 }, // 258
  { station: 'Allview Escape', sku: 'FD-07', perRunner: 0.081031, flatQty: 0 }, // 129
  { station: 'Allview Escape', sku: 'FD-08', perRunner: 0.011307, flatQty: 0 }, // 18
  { station: 'Allview Escape', sku: 'FD-11', perRunner: 0.046483, flatQty: 0 }, // 74
  { station: 'Allview Escape', sku: 'FD-12', perRunner: 0.014448, flatQty: 0 }, // 23
  { station: 'Allview Escape', sku: 'FD-13', perRunner: 0.008794, flatQty: 0 }, // 14
  { station: 'Allview Escape', sku: 'FD-24', perRunner: 0.028267, flatQty: 0 }, // 45
  { station: 'Allview Escape', sku: 'FD-09', perRunner: 0, flatQty: 2 },
  { station: 'Allview Escape', sku: 'FD-10', perRunner: 0, flatQty: 2 },
  { station: 'Perrys Lookdown', sku: 'FD-01', perRunner: 2.5, flatQty: 0 }, // 2250
  { station: 'Perrys Lookdown', sku: 'FD-02', perRunner: 0.1, flatQty: 0 }, // 90
  { station: 'Perrys Lookdown', sku: 'FD-03', perRunner: 0.013334, flatQty: 0 }, // 12
  { station: 'Perrys Lookdown', sku: 'FD-04', perRunner: 0.8, flatQty: 0 }, // 720
  { station: 'Perrys Lookdown', sku: 'FD-05', perRunner: 0.331112, flatQty: 0 }, // 298
  { station: 'Perrys Lookdown', sku: 'FD-23', perRunner: 0.3, flatQty: 0 }, // 270
  { station: 'Perrys Lookdown', sku: 'FD-06', perRunner: 0.151112, flatQty: 0 }, // 136
  { station: 'Perrys Lookdown', sku: 'FD-07', perRunner: 0.075556, flatQty: 0 }, // 68
  { station: 'Perrys Lookdown', sku: 'FD-08', perRunner: 0.01, flatQty: 0 }, // 9
  { station: 'Perrys Lookdown', sku: 'FD-11', perRunner: 0.042223, flatQty: 0 }, // 38
  { station: 'Perrys Lookdown', sku: 'FD-12', perRunner: 0.013334, flatQty: 0 }, // 12
  { station: 'Perrys Lookdown', sku: 'FD-13', perRunner: 0.008889, flatQty: 0 }, // 8
  { station: 'Perrys Lookdown', sku: 'FD-24', perRunner: 0.133334, flatQty: 0 }, // 120
  { station: 'Perrys Lookdown', sku: 'FD-14', perRunner: 0.125556, flatQty: 0 }, // 113
  { station: 'Perrys Lookdown', sku: 'FD-16', perRunner: 0.006667, flatQty: 0 }, // 6
  { station: 'Perrys Lookdown', sku: 'FD-09', perRunner: 0, flatQty: 2 },
  { station: 'Perrys Lookdown', sku: 'FD-10', perRunner: 0, flatQty: 2 },
  { station: 'Perrys Lookdown', sku: 'FD-17', perRunner: 0, flatQty: 1 },
  { station: 'Perrys Lookdown', sku: 'FD-18', perRunner: 0, flatQty: 1 },
  { station: 'Perrys Lookdown', sku: 'FD-19', perRunner: 0, flatQty: 1 },
  { station: 'Perrys Lookdown', sku: 'FD-20', perRunner: 0, flatQty: 1 },
  { station: 'Perrys Lookdown', sku: 'FD-21', perRunner: 0, flatQty: 1 },
  { station: 'Blue Gum Forest', sku: 'FD-01', perRunner: 0.751112, flatQty: 0 }, // 338
  { station: 'Blue Gum Forest', sku: 'FD-03', perRunner: 0.013334, flatQty: 0 }, // 6
  { station: 'Blue Gum Forest', sku: 'FD-13', perRunner: 0.008889, flatQty: 0 }, // 4
  { station: 'Blue Gum Forest', sku: 'FD-09', perRunner: 0, flatQty: 1 },
  { station: 'Blue Gum Forest', sku: 'FD-10', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-01', perRunner: 3, flatQty: 0 }, // 1350
  { station: 'The Pinnacles Car Park', sku: 'FD-02', perRunner: 0.151112, flatQty: 0 }, // 68
  { station: 'The Pinnacles Car Park', sku: 'FD-03', perRunner: 0.013334, flatQty: 0 }, // 6
  { station: 'The Pinnacles Car Park', sku: 'FD-04', perRunner: 0.8, flatQty: 0 }, // 360
  { station: 'The Pinnacles Car Park', sku: 'FD-05', perRunner: 0.5, flatQty: 0 }, // 225
  { station: 'The Pinnacles Car Park', sku: 'FD-23', perRunner: 0.5, flatQty: 0 }, // 225
  { station: 'The Pinnacles Car Park', sku: 'FD-06', perRunner: 0.2, flatQty: 0 }, // 90
  { station: 'The Pinnacles Car Park', sku: 'FD-07', perRunner: 0.1, flatQty: 0 }, // 45
  { station: 'The Pinnacles Car Park', sku: 'FD-08', perRunner: 0.013334, flatQty: 0 }, // 6
  { station: 'The Pinnacles Car Park', sku: 'FD-11', perRunner: 0.055556, flatQty: 0 }, // 25
  { station: 'The Pinnacles Car Park', sku: 'FD-12', perRunner: 0.017778, flatQty: 0 }, // 8
  { station: 'The Pinnacles Car Park', sku: 'FD-13', perRunner: 0.008889, flatQty: 0 }, // 4
  { station: 'The Pinnacles Car Park', sku: 'FD-24', perRunner: 0.226667, flatQty: 0 }, // 102
  { station: 'The Pinnacles Car Park', sku: 'FD-14', perRunner: 0.5, flatQty: 0 }, // 225
  { station: 'The Pinnacles Car Park', sku: 'FD-16', perRunner: 0.017778, flatQty: 0 }, // 8
  { station: 'The Pinnacles Car Park', sku: 'FD-09', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-10', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-17', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-18', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-19', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-20', perRunner: 0, flatQty: 1 },
  { station: 'The Pinnacles Car Park', sku: 'FD-21', perRunner: 0, flatQty: 1 },
];
