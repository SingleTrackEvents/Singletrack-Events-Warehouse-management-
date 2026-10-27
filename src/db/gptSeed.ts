import type { HounslowFoodLine, HounslowPacklist } from './hounslowSeed';

/**
 * GPT100 2026: starting packlists.
 *
 * From the GPT 2025 Pack List (draft): the Master Pack List tab, one column
 * per site, translated onto the warehouse catalogue by item name. The
 * per-station run sheet tabs were not used: their quantities are broken
 * formulas, and their food lists are the same numbers copied to every site.
 *
 * The black box rows are folded into the Primary Aid Station Kit wherever a
 * station carries the full box: one kit line stands for everything on the
 * laminated contents list, and only what the sheet asks for beyond that
 * (sunscreen and paper towel, mostly) gets a line of its own, noted as on top
 * of the box. Black box rows the kit does not hold, like power leads, straps,
 * table cloths and tarps, stay as their own lines. Coppermine, the Mt
 * Difficult ridgeline and Mt Zero carry a few box items but no box, so they
 * keep them as single lines.
 *
 * Rows that pair two sheet items onto one catalogue item are summed with the
 * split in the note (gas bottles for the stove and the heater, spray bottles
 * and backpacks). The picket fence goes on the Halls Gap village list only:
 * the sheet lists it at Halls Gap and Dunkeld, but it is one fence moved.
 *
 * Corrected with the crew after reading it: Sterling Place is the Dunkeld
 * finish, so its beds are on the Dunkeld list; nap beds stay as the sheet
 * has them, 3 with 5 blankets each, and none at Yarram Gap, which is a
 * basic emergency station this year; no bain marie; two
 * kettles per gas stove; one set of merch racking and two arch pumps; and
 * 10 power boards at the Halls Gap village, not 20.
 *
 * Brought up to 2026 from Chad's warehouse handover (22 and 25 Oct) and
 * GPT100_VehiclePlan_2026_v1_1:
 * - Power as the plan has it. EcoFlows at Mt Difficult Rd, Rosea and Yarram
 *   Gap, hired diesel light towers (with two labelled diesel jerries each)
 *   at Mt William, Jimmy Creek and Griffin, the larger hired generator at
 *   Borough Huts, and petrol generators only at Cassidys and Bainggug.
 * - Starlinks by unit, and a unit that moves on to another station is that
 *   station's line coming from the first, so it leaves the warehouse once.
 * - Twelve gas heaters: two in the big night shelters (Borough, Mt William,
 *   Griffin) and at Jimmy Creek.
 * - Shoe wash at every aid station and start line, two where the miler's
 *   wash is mandatory (Halls Gap, Mt William, Griffin), Sterling Place for
 *   the GPT33 at Dunkeld, and the RD's six-tub stage race kit.
 * - Eight Zempire stretchers at Dunkeld, the orange wire flags going to
 *   Julie, and no black bins (see the pack rules).
 *
 * Then matched to the GPT100 2026 Master Pack List v1.0 (25 Oct):
 * - Aid Station Boxes at Mt Zero and the village, and a Water Point Box for
 *   Coppermine and the ridgeline in place of their loose box items.
 * - Straps at 4 per ST marquee and cloths at 3 per 2 marquees, hired
 *   structures (no ST marquees) at Mt William and Griffin, pop-up tents at
 *   Jimmy Creek, and a structure at Dunkeld and the village too.
 * - The sheet's water containers, IBCs, toilets, nap beds (3 blankets
 *   each), sandbags at Mt Zero and the Mt Difficult toilet trailer.
 * - EcoFlow #1 moves on from Mt Difficult Rd to Yarram Gap, the large
 *   generator from Borough Huts to Cassidys Gap, Starlinks 3 and 4 from
 *   Rosea and Borough to Cassidys and Bainggug, and the picket fence from the
 *   village to Dunkeld. With a 2.3kVA generator still at Cassidys and
 *   Bainggug, the handover's twelve heaters (none at Mt Difficult Rd) and
 *   no firewood at Borough Huts.
 *
 * Seeded as drafts, like Hounslow and the Roller Coaster Run.
 */

export const GPT_PACKLISTS: HounslowPacklist[] = [
  {
    station: 'Mt Zero Picnic Area',
    notes: 'Vehicle: STE.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Ratchet Straps', qty: 16 },
      { item: 'Sunscreen', qty: 7, note: 'On top of the 1 in the Aid Station Box (8 in all)' },
      { item: 'Table Cloths', qty: 6 },
      { item: 'Stand Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 16 },
      { item: 'Sandbags', qty: 10, note: 'Hessian' },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 4 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 8 },
      { item: 'Trestle Tables', qty: 6 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Plastic Tubs for Serving Ice', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 192 },
      { item: 'Portable Toilets', qty: 18, note: 'Betta Bathroom Hire, skid mounted, in place all event. 6 move down to Griffin Fireline for Sunday' },
      { item: 'Soccer Cones', qty: 25 },
      { item: 'International / Participant / Presentation Flags', qty: 25 },
      { item: 'Flag Poles', qty: 25 },
      { item: 'Bunting (lengths)', qty: 8 },
      { item: 'Traffic Bollards and Bases', qty: 10 },
      { item: 'Shoe Wash Kit', qty: 1 },
      { item: 'Starlink Mini', qty: 1, note: 'Starlink Mini 1. Moves on to Jimmy Creek Campground on Friday.' },
      { item: 'PA System / VONYX + Mic + Stand', qty: 1 },
      { item: 'Finish Gantry (Running Wild)', qty: 1 },
      { item: 'Toolbox', qty: 1, note: 'Finish gantry tool box' },
      { item: 'Crowd Barriers', qty: 6 },
    ],
  },
  {
    station: 'Coppermine',
    notes: 'Vehicle: VAN #1.',
    lines: [
      { item: 'Water Point Box', qty: 1 },
      { item: 'Serving Jugs (2L, marked)', qty: 4, note: 'On top of the 4 in the Water Point Box (8 in all)' },
      { item: 'Salt', qty: 1 },
      { item: 'Sugar', qty: 1 },
      { item: 'Trestle Tables', qty: 4 },
      { item: 'Esky / Cooler', qty: 4 },
      { item: 'Hose & Fittings / Spray Nozzle', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 1 },
      { item: 'Water Containers (20L equiv)', qty: 20 },
      { item: 'Starlink Mini', qty: 1, note: 'Starlink Mini 2. Moves on to Stockyard Track on Friday.' },
    ],
  },
  {
    station: 'GAR Trailhead',
    notes: 'Vehicle: VAN #2.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Jug - 500ml (Ice Water)', qty: 2 },
      { item: 'Ratchet Straps', qty: 32 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 12 },
      { item: 'Tarps', qty: 2 },
      { item: 'Chairs - Plastic Bistro', qty: 20, note: 'Hired' },
      { item: 'Weights - Steel 20kg', qty: 32 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 8 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 24 },
      { item: 'Trestle Tables', qty: 15 },
      { item: 'Esky / Cooler', qty: 3 },
      { item: 'Hose & Fittings / Spray Nozzle', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 2 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 8 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'IBC Water Container (1000L)', qty: 2 },
      { item: 'IBC Pipe', qty: 2 },
      { item: 'Portable Toilets', qty: 3, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Ice Baths (DOPE)', qty: 1 },
      { item: 'Starlink Mini', qty: 1, note: 'Starlink Mini 3. Moves on to Yarram Gap Rd on Friday.' },
      { item: 'Shoe Wash Kit', qty: 1 },
    ],
  },
  {
    station: 'Mt Difficult Ridgeline',
    notes: 'Hiked in, no vehicle.',
    lines: [
      { item: 'Water Point Box', qty: 1 },
      { item: 'Serving Jugs (2L, marked)', qty: 4 },
      { item: 'Salt', qty: 1 },
      { item: 'Sugar', qty: 1 },
    ],
  },
  {
    station: 'Mt Difficult Rd',
    notes: 'Vehicle: VAN #3.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 1 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 12 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 5 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 1 },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 15, note: 'Hired' },
      { item: 'EcoFlow Battery (1 kWh)', qty: 1, note: 'EcoFlow #1. Moves on to Yarram Gap Rd after the Friday cut-off' },
      { item: 'Weights - Steel 20kg', qty: 12 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 3 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 9 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 4 },
      { item: 'Plastic Tubs for Serving Ice', qty: 2 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2, note: '1 spray bottle, 1 backpack' },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'Twin Toilet Trailer', qty: 1, note: 'Betta drops it in Halls Gap; a SingleTrack vehicle tows it up' },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Starlink', qty: 1, note: 'Starlink 2. Moves on to Griffin Fireline on Friday night.' },
      { item: 'Shoe Wash Kit', qty: 1 },
    ],
  },
  {
    station: 'Halls Gap',
    notes: 'Vehicle: STE. Drop bags.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Power Board', qty: 2 },
      { item: 'Jug - 500ml (Ice Water)', qty: 1 },
      { item: 'Spatula', qty: 2 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Lighter', qty: 1 },
      { item: 'Electric Hot Water Urn', qty: 1 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 1 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 48 },
      { item: 'Shoe Wash Kit', qty: 2, note: 'Stage 2 start, and the miler\'s mandatory wash' },
      { item: 'Ice Baths (DOPE)', qty: 1 },
      { item: 'Starlink', qty: 1, note: 'Starlink 1. Moves on to Dunkeld on Friday evening.' },
      { item: 'Finish Gantry (Running Wild)', qty: 1 },
      { item: 'Toolbox', qty: 1, note: 'Finish gantry tool box' },
      { item: 'Crowd Barriers', qty: 8 },
    ],
  },
  {
    station: 'Rosea Carpark',
    notes: 'Vehicle: VAN #4.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 1 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 2, note: '1 stove, 1 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'EcoFlow Battery (1 kWh)', qty: 1, note: 'EcoFlow #2' },
      { item: 'Gas Heater', qty: 1 },
      { item: 'Stand Light', qty: 2 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'Portable Toilets', qty: 1, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Starlink', qty: 1, note: 'Starlink 3. Moves on to Cassidys Gap' },
      { item: 'Shoe Wash Kit', qty: 1 },
      { item: 'Festoon Lighting (10m lengths)', qty: 1 },
    ],
  },
  {
    station: 'Borough Huts',
    notes: 'Vehicle: VAN #5.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 2 },
      { item: 'Extension Cable - 20m Heavy Duty', qty: 1 },
      { item: 'Power Board', qty: 1 },
      { item: 'Hammer / Mallet', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 1 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 12 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 5 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 6, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 3, note: '1 stove, 2 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'Large Generator (Hired)', qty: 1, note: 'The larger hired generator. Moves on to Cassidys Gap' },
      { item: 'RCD (Portable Safety Switch)', qty: 1 },
      { item: 'Gas Heater', qty: 2, note: 'Warming shelter' },
      { item: 'Jerry Can (Fuel)', qty: 1, note: 'Petrol for the large generator' },
      { item: 'Stand Light', qty: 2 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 12 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 3 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 12 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'Portable Toilets', qty: 1, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Camp Stretcher / Folding Bed', qty: 4 },
      { item: 'Blankets / Space Blankets', qty: 12, note: '3 per bed' },
      { item: 'Starlink', qty: 1, note: 'Starlink 4. Moves on to Bainggug Carpark' },
      { item: 'Shoe Wash Kit', qty: 1 },
      { item: 'Festoon Lighting (10m lengths)', qty: 1 },
    ],
  },
  {
    station: 'Mt William Carpark',
    notes: 'Vehicle: VAN #6. Stage race drop bags (Shuttle Bus #1). Miler drop bags (Shuttle Bus #1).',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 3 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 2 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Spatula', qty: 2 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Cable Ties', qty: 1, note: 'On top of the 1 in the Aid Station Box (2 in all)' },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 6, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 3, note: '1 stove, 2 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'Electric Hot Water Urn', qty: 1 },
      { item: 'Light Tower (Diesel, Hired)', qty: 1 },
      { item: 'Jerry Can 20 L (Diesel, labelled)', qty: 2, note: 'Labelled, they sit with the tower' },
      { item: 'Gas Heater', qty: 2, note: 'Structural marquee, high roof' },
      { item: 'Stand Light', qty: 2 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Hired Structure (Prestige Hire)', qty: 1, note: '6m x 12m, weighted. Parks Vic bollard off the space' },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Plastic Tubs for Serving Ice', qty: 2 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 48 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Portable Toilets', qty: 4, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Camp Stretcher / Folding Bed', qty: 4 },
      { item: 'Blankets / Space Blankets', qty: 12, note: '3 per bed' },
      { item: 'Shoe Wash Kit', qty: 2, note: 'Stage 3 start, and the miler\'s mandatory wash' },
      { item: 'Starlink', qty: 1, note: 'Starlink 5' },
      { item: 'Festoon Lighting (10m lengths)', qty: 1 },
    ],
  },
  {
    station: 'Jimmy Creek Rd',
    notes: 'Vehicle: VAN #7. Miler drop bags (Shuttle Bus #2).',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 2 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 2 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 32 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 12 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 3, note: '1 stove, 2 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'Light Tower (Diesel, Hired)', qty: 1 },
      { item: 'Jerry Can 20 L (Diesel, labelled)', qty: 2, note: 'Labelled, they sit with the tower' },
      { item: 'Gas Heater', qty: 2 },
      { item: 'Stand Light', qty: 2 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 32 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 8, note: 'Pop-up tents: Parks Vic turned down the hired structure' },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 24 },
      { item: 'Trestle Tables', qty: 4 },
      { item: 'Esky / Cooler', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Portable Toilets', qty: 2, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Camp Stretcher / Folding Bed', qty: 4 },
      { item: 'Blankets / Space Blankets', qty: 12, note: '3 per bed' },
      { item: 'Starlink Mini', qty: 1, note: 'Starlink Mini 1', from: 'Mt Zero Picnic Area' },
      { item: 'Shoe Wash Kit', qty: 1 },
      { item: 'Ice Baths (DOPE)', qty: 1 },
      { item: 'Festoon Lighting (10m lengths)', qty: 1 },
    ],
  },
  {
    station: 'Yarram Gap Rd',
    notes: 'Vehicle: VAN #8.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 2 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 2 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 2, note: '1 stove, 1 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'EcoFlow Battery (1 kWh)', qty: 1, note: 'EcoFlow #1', from: 'Mt Difficult Rd' },
      { item: 'Gas Heater', qty: 1 },
      { item: 'Stand Light', qty: 1 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 1 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'Portable Toilets', qty: 1, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Starlink Mini', qty: 1, note: 'Starlink Mini 3', from: 'GAR Trailhead' },
      { item: 'Shoe Wash Kit', qty: 1 },
      { item: 'Camp Stretcher / Folding Bed', qty: 4 },
      { item: 'Blankets / Space Blankets', qty: 12, note: '3 per bed' },
    ],
  },
  {
    station: 'Griffin Fireline',
    notes: 'Vehicle: VAN #1. Stage race drop bags (Shuttle Bus #1). Drop bags (DTR).',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 3 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 2 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Spatula', qty: 2 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Cable Ties', qty: 1, note: 'On top of the 1 in the Aid Station Box (2 in all)' },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 6, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 3, note: '1 stove, 2 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'Electric Hot Water Urn', qty: 1 },
      { item: 'Light Tower (Diesel, Hired)', qty: 1 },
      { item: 'Jerry Can 20 L (Diesel, labelled)', qty: 2, note: 'Labelled, they sit with the tower' },
      { item: 'Gas Heater', qty: 2, note: 'Rest and sleep base' },
      { item: 'Stand Light', qty: 1 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Hired Structure (Prestige Hire)', qty: 1, note: '6m x 12m, weighted. Parks Vic bollard off the space' },
      { item: 'Trestle Tables', qty: 4 },
      { item: 'Esky / Cooler', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 2 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 3, note: '2 spray bottle, 1 backpack' },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 48 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Portable Toilets', qty: 2, note: 'Betta Bathroom Hire, skid mounted, in place all event. Plus 6 more Betta moves down from Mt Zero for Sunday' },
      { item: 'Camp Stretcher / Folding Bed', qty: 4 },
      { item: 'Blankets / Space Blankets', qty: 12, note: '3 per bed' },
      { item: 'Shoe Wash Kit', qty: 2, note: 'Stage 4 start, and the miler\'s mandatory wash' },
      { item: 'Ice Baths (DOPE)', qty: 1 },
      { item: 'Starlink', qty: 1, note: 'Starlink 2', from: 'Mt Difficult Rd' },
      { item: 'Festoon Lighting (10m lengths)', qty: 1 },
    ],
  },
  {
    station: 'Cassidys Gap',
    notes: 'Vehicle: VAN #2.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 2 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 1 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 2, note: '1 stove, 1 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'Generator', qty: 1, note: '2.3kVA' },
      { item: 'Large Generator (Hired)', qty: 1, note: 'The larger hired generator', from: 'Borough Huts' },
      { item: 'Gas Heater', qty: 1 },
      { item: 'Jerry Can (Fuel)', qty: 1 },
      { item: 'Stand Light', qty: 1 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 2 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 1 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Portable Toilets', qty: 1, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Camp Stretcher / Folding Bed', qty: 3 },
      { item: 'Blankets / Space Blankets', qty: 9, note: '3 per bed' },
      { item: 'Ice Baths (DOPE)', qty: 1 },
      { item: 'Starlink', qty: 1, note: 'Starlink 3', from: 'Rosea Carpark' },
      { item: 'Shoe Wash Kit', qty: 1 },
    ],
  },
  {
    station: 'Bainggug Carpark',
    notes: 'Vehicle: VAN #3.',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 2 },
      { item: 'Extension Cable (5m+)', qty: 2 },
      { item: 'Power Board', qty: 1 },
      { item: 'Jug - 500ml (Ice Water)', qty: 2 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 12 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 5 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 2, note: '1 stove, 1 heater' },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 10, note: 'Hired' },
      { item: 'Generator', qty: 1, note: '2.3kVA' },
      { item: 'Gas Heater', qty: 1 },
      { item: 'Jerry Can (Fuel)', qty: 1 },
      { item: 'Stand Light', qty: 1 },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 12 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 3 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 10 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Esky / Cooler', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Spray Bottle / Backpack (Ice Water)', qty: 2 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 12 },
      { item: 'IBC Water Container (1000L)', qty: 1 },
      { item: 'IBC Pipe', qty: 1 },
      { item: 'Portable Toilets', qty: 1, note: 'Betta Bathroom Hire, skid mounted, in place all event' },
      { item: 'Starlink', qty: 1, note: 'Starlink 4', from: 'Borough Huts' },
      { item: 'Shoe Wash Kit', qty: 1 },
      { item: 'Camp Stretcher / Folding Bed', qty: 3 },
      { item: 'Blankets / Space Blankets', qty: 9, note: '3 per bed' },
    ],
  },
  {
    station: 'Dunkeld Finish',
    notes: 'Vehicle: STE. Stage race drop bags (Shuttle Bus #1). Drop bags (Sally).',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 1, note: 'Aid Station Box' },
      { item: 'Electrical Power Cable (2-3m)', qty: 3 },
      { item: 'Extension Cable (5m+)', qty: 2 },
      { item: 'Power Board', qty: 2 },
      { item: 'Kettle - Stove Top', qty: 2 },
      { item: 'Ratchet Straps', qty: 8 },
      { item: 'Sunscreen', qty: 3, note: 'On top of the 1 in the Aid Station Box (4 in all)' },
      { item: 'Table Cloths', qty: 3 },
      { item: 'Tarps', qty: 2 },
      { item: 'Orange Cable Lead Cover', qty: 1 },
      { item: 'Paper Towel / Chux', qty: 2, note: 'On top of the 2 in the Aid Station Box (4 in all)' },
      { item: 'Insulated Hot Cups', qty: 4, note: 'Packs of 50' },
      { item: 'Sporks / Cutlery', qty: 4, note: 'Packs of 50' },
      { item: 'Toastie / Jaffle Maker', qty: 1 },
      { item: 'Gas Stove', qty: 1 },
      { item: 'Gas Bottle', qty: 1 },
      { item: 'Lighter', qty: 1 },
      { item: 'Chairs - Plastic Bistro', qty: 30, note: 'Hired' },
      { item: 'Stand Light', qty: 2 },
      { item: 'Hired Structure (Prestige Hire)', qty: 1, note: '6m x 6m on the Visitor Centre lawn, no pegging' },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 6 },
      { item: 'Trestle Tables', qty: 2 },
      { item: 'Hose & Fittings / Spray Nozzle', qty: 1 },
      { item: 'Plastic Tubs for Serving Ice', qty: 1 },
      { item: 'Water Containers (20L equiv)', qty: 4 },
      { item: 'Toilet Paper', qty: 96 },
      { item: 'Bunting (lengths)', qty: 8 },
      { item: 'Traffic Bollards and Bases', qty: 10 },
      { item: 'Ice Baths (DOPE)', qty: 1 },
      { item: 'Camp Stretcher / Folding Bed', qty: 8, note: 'Zempire only, so the stock is not mixed. Sterling Place on the sheet.' },
      { item: 'Blankets / Space Blankets', qty: 24, note: '3 per bed' },
      { item: 'Starlink', qty: 1, note: 'Starlink 1', from: 'Halls Gap' },
      { item: 'Shoe Wash Kit', qty: 2, note: 'One at the finish, one at Sterling Place for the GPT33 before the bus' },
      { item: 'Finish Gantry (Running Wild)', qty: 1 },
      { item: 'Toolbox', qty: 1, note: 'Finish gantry tool box' },
      { item: 'Inflatable Arch', qty: 1 },
      { item: 'Crowd Barriers', qty: 20 },
      { item: 'Festoon Lighting (10m lengths)', qty: 4 },
      { item: 'Picket Fence', qty: 1, note: 'White picket fence', from: 'Halls Gap Event Village' },
    ],
  },
  {
    station: 'Halls Gap Event Village',
    lines: [
      { item: 'Primary Aid Station Kit (3 x Black Tubs)', qty: 2, note: 'Aid Station Boxes' },
      { item: 'Electrical Power Cable (2-3m)', qty: 12 },
      { item: 'Extension Cable (5m+)', qty: 10 },
      { item: 'Power Board', qty: 10 },
      { item: 'Hammer / Mallet', qty: 2 },
      { item: 'Hand Sanitiser', qty: 10 },
      { item: 'Ratchet Straps', qty: 13, note: '12 general, 1 for vendor marquees' },
      { item: 'Sanitiser Cleaning Spray (Spray & Wipe)', qty: 4 },
      { item: 'Scissors / Snippers', qty: 6 },
      { item: 'Sunscreen', qty: 8 },
      { item: 'Table Cloths', qty: 12 },
      { item: 'Tarps', qty: 6 },
      { item: 'Orange Cable Lead Cover', qty: 4 },
      { item: 'Cable Ties', qty: 10 },
      { item: 'Bin Bags (large / roll)', qty: 4 },
      { item: 'Paper Towel / Chux', qty: 10 },
      { item: 'Chairs - Plastic Bistro', qty: 105, note: 'Hired' },
      { item: 'Strip Light', qty: 2 },
      { item: 'Weights - Steel 20kg', qty: 8 },
      { item: 'Marquee - ST 3x3 (or equivalent)', qty: 2 },
      { item: 'Marquee Walls - 3x3 (or equivalent)', qty: 8 },
      { item: 'Trestle Tables', qty: 16 },
      { item: 'Hired Structure (Prestige Hire)', qty: 1, note: '6m x 18m pavilion, pegged subject to the shire services check' },
      { item: 'Hose & Fittings / Spray Nozzle', qty: 1 },
      { item: 'Toilet Paper', qty: 96 },
      { item: 'Firestarters', qty: 5 },
      { item: 'PA System / VONYX + Mic + Stand', qty: 1 },
      { item: 'Inflatable Arch Pump', qty: 2, note: 'All we have' },
      { item: 'ASICS Vehicle', qty: 1 },
      { item: 'Batteries (AA)', qty: 10 },
      { item: 'Batteries (AAA)', qty: 10 },
      { item: 'Power Electrical Cable (20m+)', qty: 5 },
      { item: 'Extension Cable - 15 AMP', qty: 2 },
      { item: 'Extension Cable - 20m Heavy Duty', qty: 8 },
      { item: 'Mesh Banner Toggles', qty: 50 },
      { item: 'CCB Mesh Banners', qty: 20, note: 'Visit Victoria; ASICS Australia' },
      { item: 'Toilet Signage', qty: 4, note: '2 out of use, 2 male/female' },
      { item: 'Lounge Chairs', qty: 10 },
      { item: 'Festoon Lighting (10m lengths)', qty: 4 },
      { item: 'Inflatable Pillar', qty: 1, note: 'ASICS' },
      { item: 'Picnic Blankets', qty: 20 },
      { item: 'ASICS Umbrellas', qty: 10 },
      { item: 'Umbrella Bases', qty: 10 },
      { item: 'PURE Flags', qty: 6 },
      { item: 'Merch Racking (complete set)', qty: 2, note: 'All we have' },
      { item: 'Picket Fence', qty: 1, note: 'White picket fence, moves on to Dunkeld Finish' },
      { item: 'Track Mat / Carpet', qty: 1 },
      { item: 'Industrial Foil - 1 Roll per 20 Potatoes', qty: 34, note: '1 roll per 20 potatoes' },
      { item: 'Kids Table + Chair Set', qty: 1 },
      { item: 'Kids Activity Kit (colouring, games)', qty: 1 },
      { item: 'Safety Pins', qty: 4 },
      { item: 'Internet Dongle', qty: 1 },
      { item: 'PURE Retail Products', qty: 1 },
      { item: 'Registration Lists / Distance Signs', qty: 2 },
      { item: 'Merch - iPad & Square Reader', qty: 2 },
      { item: 'Finisher Medals', qty: 1 },
      { item: 'Merchandise', qty: 1 },
      { item: 'Printer', qty: 1 },
      { item: 'Printer Ink', qty: 1 },
      { item: 'Laminator', qty: 1 },
      { item: 'Laminator Sheets', qty: 2 },
      { item: 'Paper (packs)', qty: 2 },
      { item: 'Shoe Wash Kit', qty: 6, note: 'Stage race kit: six tubs that travel with the RD to each stage start' },
      { item: 'Orange Wire Flags', qty: 1, note: 'All of them, for Julie for the Mt Buller SkyRun' },
    ],
  },
  {
    station: 'Stockyard Track',
    notes: 'From the 2026 vehicle plan. Ray Taylor\'s 4WD takes the Stockyard kit.',
    lines: [
      { item: 'Starlink Mini', qty: 1, note: 'Starlink Mini 2', from: 'Coppermine' },
      { item: 'Water Containers (20L equiv)', qty: 10 },
    ],
  },
];

/**
 * Lines the 2026 plan takes off last year's lists. Removed only where nobody
 * has touched them, like every other seeded change.
 */
export const GPT_RETIRED: Array<{ station: string; item: string }> = [
  // Swapped for an EcoFlow, a light tower or the hired generator.
  ...['Mt Difficult Rd', 'Rosea Carpark', 'Mt William Carpark', 'Jimmy Creek Rd', 'Yarram Gap Rd', 'Griffin Fireline'].flatMap(
    (station) => [
      { station, item: 'Generator' },
      { station, item: 'Jerry Can (Fuel)' },
    ],
  ),
  { station: 'Borough Huts', item: 'Generator' },
  // A Starlink Mini instead of a full Starlink.
  ...['Mt Zero Picnic Area', 'GAR Trailhead', 'Jimmy Creek Rd', 'Yarram Gap Rd'].map((station) => ({
    station,
    item: 'Starlink',
  })),
  // The hired large generator goes to Borough Huts; the village has mains power.
  { station: 'Halls Gap Event Village', item: 'Large Generator (Hired)' },
  // Off the lists by the GPT100 2026 Master Pack List.
  { station: 'Mt Zero Picnic Area', item: 'Electrolyte Measuring Cup' },
  { station: 'Mt Zero Picnic Area', item: 'Scissors / Snippers' },
  { station: 'Mt Zero Picnic Area', item: 'Cable Ties' },
  { station: 'Mt Zero Picnic Area', item: 'Bin Bags (large / roll)' },
  { station: 'Mt Zero Picnic Area', item: 'Female Sanitary Items' },
  { station: 'Coppermine', item: 'Gloves' },
  { station: 'Coppermine', item: 'Hand Sanitiser' },
  { station: 'Coppermine', item: 'Electrolyte Measuring Cup' },
  { station: 'Coppermine', item: 'Jug - 500ml (Ice Water)' },
  { station: 'Coppermine', item: 'Scissors / Snippers' },
  { station: 'Coppermine', item: 'Small Freezer Bags' },
  { station: 'Coppermine', item: 'Sponges' },
  { station: 'Coppermine', item: 'Sunscreen' },
  { station: 'Coppermine', item: 'Cable Ties' },
  { station: 'GAR Trailhead', item: 'Pallets for IBCs' },
  { station: 'Mt Difficult Ridgeline', item: 'Gloves' },
  { station: 'Mt Difficult Ridgeline', item: 'Electrolyte Measuring Cup' },
  { station: 'Mt Difficult Ridgeline', item: 'Jug - 500ml (Ice Water)' },
  { station: 'Mt Difficult Ridgeline', item: 'Scissors / Snippers' },
  { station: 'Mt Difficult Ridgeline', item: 'Sponges' },
  { station: 'Mt Difficult Ridgeline', item: 'Sunscreen' },
  { station: 'Mt Difficult Ridgeline', item: 'Cable Ties' },
  { station: 'Mt Difficult Rd', item: 'Portable Toilets' },
  { station: 'Borough Huts', item: 'Firewood' },
  { station: 'Borough Huts', item: 'Kindling' },
  { station: 'Borough Huts', item: 'Pegs - Small' },
  { station: 'Mt William Carpark', item: 'Marquee - ST 3x3 (or equivalent)' },
  { station: 'Mt William Carpark', item: 'Marquee Walls - 3x3 (or equivalent)' },
  { station: 'Mt William Carpark', item: 'Weights - Steel 20kg' },
  { station: 'Mt William Carpark', item: 'Ratchet Straps' },
  { station: 'Griffin Fireline', item: 'Marquee - ST 3x3 (or equivalent)' },
  { station: 'Griffin Fireline', item: 'Marquee Walls - 3x3 (or equivalent)' },
  { station: 'Griffin Fireline', item: 'Weights - Steel 20kg' },
  { station: 'Griffin Fireline', item: 'Ratchet Straps' },
];

/*
 * The food plan, from GPT_2026_Aid Station Consumptions (projections at the
 * 12 Oct entry report). The sheet works in blocks of runners, one per day of
 * racing, and each block becomes the races it counts:
 *
 * - Thursday: the 50k and Stage 1 (Mt Zero to Halls Gap) at the same rates,
 *   and the GPT14k and GPT6k at Wonderland.
 * - The miler from Friday, at every station Mt Zero to Dunkeld.
 * - Stage 2 on Friday, Stage 3 on Saturday, and Stage 4 with the GPT33 on
 *   Sunday, with the 2k kids and 5k family runs at Dunkeld.
 *
 * Rates are per runner, as the sheet has them. Coke and ginger beer are
 * measured in litres there and in cans here (375 ml and 200 ml). Where two
 * races share a block, the ridgeline's flat electrolyte and lollies go on the
 * larger field only, so they are not doubled. Sugar, tea, coffee, Milo and
 * milk are one of each per hot drinks station for the whole event, as the
 * sheet orders them, on the first race through: the 50k at Mt Difficult Rd
 * and Halls Gap, the miler everywhere else.
 *
 * Toasties are made, not bought, so what goes on the plan is what they are
 * made from, worked out per jaffle the way the sheet's ingredient rows do:
 * two slices of bread (about 13 jaffles to a loaf), two cheese slices, one in
 * ten vegan, a spray bottle per 50 and a tin of beans per 10.
 *
 * Two things the sheet does that this does not. Its miler block counts Mt
 * William and Jimmy Creek against 320 runners rather than its own 246, so
 * those two stations come out smaller here. And it rounds once per block
 * where this rounds per race, so a shared block can come out one higher.
 */

type FoodKey =
  | 'water'
  | 'ice'
  | 'electrolyte'
  | 'gels'
  | 'coke'
  | 'gingerBeer'
  | 'bananas'
  | 'oranges'
  | 'watermelon'
  | 'sugar'
  | 'chips'
  | 'marsSnickers'
  | 'lollies'
  | 'potatoes'
  | 'noodles'
  | 'noodlesGf'
  | 'soup'
  | 'tea'
  | 'coffee'
  | 'milo'
  | 'cowMilk'
  | 'soyMilk'
  | 'bread'
  | 'cheese'
  | 'veganCheese'
  | 'oilSpray'
  | 'bakedBeans'
  | 'breadGf';

const FOOD_SKU: Record<FoodKey, string> = {
  water: 'FD-01',
  ice: 'FD-02',
  electrolyte: 'FD-03',
  gels: 'FD-04',
  coke: 'FD-05',
  gingerBeer: 'FD-23',
  bananas: 'FD-06',
  oranges: 'FD-07',
  watermelon: 'FD-08',
  sugar: 'FD-10',
  chips: 'FD-11',
  marsSnickers: 'FD-12',
  lollies: 'FD-13',
  potatoes: 'FD-24',
  noodles: 'FD-14',
  noodlesGf: 'FD-15',
  soup: 'FD-16',
  tea: 'FD-17',
  coffee: 'FD-18',
  milo: 'FD-19',
  cowMilk: 'FD-20',
  soyMilk: 'FD-21',
  bread: 'FD-25',
  cheese: 'FD-26',
  veganCheese: 'FD-27',
  oilSpray: 'FD-28',
  bakedBeans: 'FD-29',
  breadGf: 'FD-30',
};

type Rates = Partial<Record<FoodKey, number>>;

interface FoodStation {
  station: string;
  perRunner: Rates;
  flat?: Rates;
}

/** Litres of Coke and ginger beer per runner, as cans. */
const coke = (litres: number) => litres / 0.375;
const gingerBeer = (litres: number) => litres / 0.2;

/** The sheet's electrolyte rates: 1 kg packets per runner. */
const ELECTROLYTE = { full: 0.021067, mid: 0.014045, water: 0.00927 };

/** A full table's fruit, chips and bars, with Coke at the given litres per runner. */
const table = (cokeLitres: number): Rates => ({
  gels: 0.8,
  coke: coke(cokeLitres),
  gingerBeer: gingerBeer(0.06),
  bananas: 0.15,
  oranges: 0.075,
  watermelon: 0.009,
  chips: 0.041667,
  marsSnickers: 0.0125,
  lollies: 0.007,
});

/** Noodles, gluten free noodles and soup at a hot food station. */
const hotFood = (noodles: number): Rates => ({ noodles, noodlesGf: 0.02, soup: 0.0125 });

/** What a jaffle per runner at this rate takes to make. */
const toasties = (perRunner: number): Rates => ({
  bread: (perRunner * 2) / 13,
  cheese: perRunner / 15,
  veganCheese: perRunner * 0.02,
  oilSpray: perRunner / 50,
  bakedBeans: perRunner / 10,
  breadGf: perRunner * 0.008,
});

const HOT_DRINKS: Rates = { sugar: 1, tea: 1, coffee: 1, milo: 1, cowMilk: 1, soyMilk: 1 };

const MILER: FoodStation[] = [
  { station: 'Mt Zero Picnic Area', perRunner: { water: 0.5, ice: 0.066, electrolyte: 0.005618 } },
  { station: 'Coppermine', perRunner: { water: 1, ice: 0.05, electrolyte: ELECTROLYTE.water, lollies: 0.007 } },
  {
    station: 'GAR Trailhead',
    perRunner: { water: 4, ice: 0.2, electrolyte: ELECTROLYTE.full, ...table(0.12375), potatoes: 0.2 },
  },
  { station: 'Mt Difficult Ridgeline', perRunner: { water: 1 }, flat: { electrolyte: 10, lollies: 5 } },
  {
    station: 'Mt Difficult Rd',
    perRunner: { water: 4, ice: 0.2, electrolyte: ELECTROLYTE.full, ...table(0.15), potatoes: 0.25, ...hotFood(0.2) },
  },
  {
    station: 'Halls Gap',
    perRunner: {
      water: 3,
      ice: 0.15,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      potatoes: 0.25,
      ...hotFood(0.4),
      ...toasties(0.4),
    },
  },
  {
    station: 'Rosea Carpark',
    perRunner: { water: 3.5, ice: 0.15, electrolyte: ELECTROLYTE.full, ...table(0.15), potatoes: 0.25, ...hotFood(0.4) },
    flat: HOT_DRINKS,
  },
  {
    station: 'Borough Huts',
    perRunner: {
      water: 4,
      ice: 0.15,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      potatoes: 0.25,
      ...hotFood(0.4),
      ...toasties(0.5),
    },
    flat: HOT_DRINKS,
  },
  {
    station: 'Seven Dials Track',
    perRunner: { water: 1, ice: 0.05, electrolyte: ELECTROLYTE.water, lollies: 0.007 },
  },
  {
    station: 'Mt William Carpark',
    perRunner: {
      water: 4,
      ice: 0.15,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      potatoes: 0.25,
      ...hotFood(0.4),
      ...toasties(0.5),
    },
    flat: HOT_DRINKS,
  },
  {
    station: 'Stockyard Track',
    perRunner: { water: 1.5, ice: 0.1, electrolyte: ELECTROLYTE.mid, lollies: 0.01 },
  },
  {
    station: 'Jimmy Creek Rd',
    perRunner: {
      water: 4,
      ice: 0.15,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      potatoes: 0.25,
      ...hotFood(0.4),
      ...toasties(0.5),
    },
    flat: HOT_DRINKS,
  },
  {
    station: 'Yarram Gap Rd',
    perRunner: { water: 3.5, ice: 0.15, electrolyte: ELECTROLYTE.full, lollies: 0.007 },
  },
  {
    station: 'Griffin Fireline',
    perRunner: {
      water: 4,
      ice: 0.15,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      potatoes: 0.25,
      ...hotFood(0.4),
      ...toasties(0.5),
    },
    flat: HOT_DRINKS,
  },
  {
    station: 'Cassidys Gap',
    perRunner: {
      water: 3.5,
      ice: 0.15,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      potatoes: 0.25,
      ...hotFood(0.4),
      ...toasties(0.5),
    },
    flat: HOT_DRINKS,
  },
  {
    station: 'Bainggug Carpark',
    perRunner: { water: 3, ice: 0.15, electrolyte: ELECTROLYTE.full, ...table(0.15), potatoes: 0.25, ...hotFood(0.4) },
    flat: HOT_DRINKS,
  },
  {
    station: 'Dunkeld Finish',
    perRunner: {
      water: 1.5,
      ice: 0.05,
      electrolyte: ELECTROLYTE.full,
      ...table(0.15),
      gels: 0,
      ...hotFood(0.4),
      ...toasties(0.5),
    },
    flat: HOT_DRINKS,
  },
];

/** The 50k and Stage 1, Thursday, Mt Zero to Halls Gap. */
const STAGE_1: FoodStation[] = [
  { station: 'Mt Zero Picnic Area', perRunner: { water: 0.5, electrolyte: 0.002809 } },
  { station: 'Coppermine', perRunner: { water: 1, ice: 0.05, electrolyte: ELECTROLYTE.water, lollies: 0.007 } },
  {
    station: 'GAR Trailhead',
    perRunner: { water: 4, ice: 0.2, electrolyte: ELECTROLYTE.full, ...table(0.12375), potatoes: 0.2 },
  },
  { station: 'Mt Difficult Ridgeline', perRunner: { water: 1 }, flat: { electrolyte: 10, lollies: 10 } },
  {
    station: 'Mt Difficult Rd',
    perRunner: { water: 4, ice: 0.2, electrolyte: ELECTROLYTE.full, ...table(0.12375), potatoes: 0.25, ...hotFood(0.2) },
    flat: HOT_DRINKS,
  },
  {
    station: 'Halls Gap',
    perRunner: { water: 1.5, ice: 0.1, electrolyte: ELECTROLYTE.full, ...table(0.15), gels: 0 },
    flat: HOT_DRINKS,
  },
];

/** A stage's halfway hot food table, at the sheet's stage rates. */
const stageTable = (water: number, potatoes: number, noodles: number): Rates => ({
  water,
  ice: 0.2,
  electrolyte: ELECTROLYTE.full,
  ...table(0.12375),
  potatoes,
  ...(noodles ? hotFood(noodles) : {}),
});

/** A stage finish: no gels, hot food and drinks. */
const stageFinish: Rates = {
  water: 1.5,
  ice: 0.1,
  electrolyte: ELECTROLYTE.full,
  ...table(0.15),
  gels: 0,
  potatoes: 0.25,
  ...hotFood(0.2),
};

const STAGE_2: FoodStation[] = [
  { station: 'Rosea Carpark', perRunner: stageTable(4, 0.2, 0) },
  { station: 'Borough Huts', perRunner: stageTable(4, 0.25, 0.2) },
  {
    station: 'Seven Dials Track',
    perRunner: { water: 1, ice: 0.05, electrolyte: ELECTROLYTE.water, lollies: 0.007 },
  },
  { station: 'Mt William Carpark', perRunner: stageFinish },
];

const STAGE_3: FoodStation[] = [
  {
    station: 'Stockyard Track',
    perRunner: { water: 1, ice: 0.05, electrolyte: ELECTROLYTE.water, lollies: 0.007 },
  },
  { station: 'Jimmy Creek Rd', perRunner: stageTable(4, 0.25, 0.2) },
  {
    station: 'Yarram Gap Rd',
    perRunner: { water: 3.5, ice: 0.2, electrolyte: ELECTROLYTE.full, lollies: 0.007 },
  },
  { station: 'Griffin Fireline', perRunner: stageFinish },
];

/** Stage 4 and the GPT33, Sunday, Cassidys Gap to Dunkeld. */
const STAGE_4: FoodStation[] = [
  { station: 'Cassidys Gap', perRunner: stageTable(3.5, 0.25, 0.2) },
  { station: 'Bainggug Carpark', perRunner: stageTable(3.5, 0.25, 0.2) },
  { station: 'Dunkeld Finish', perRunner: stageFinish },
];

const KIDS_AND_FAMILY: FoodStation[] = [
  {
    station: 'Dunkeld Finish',
    perRunner: {
      water: 1,
      ice: 0.04,
      electrolyte: ELECTROLYTE.mid,
      ...table(0.1125),
      gels: 0,
    },
  },
];

const GPT14K: FoodStation[] = [
  {
    station: 'Wonderland Carpark',
    perRunner: {
      water: 1,
      ice: 0.05,
      electrolyte: ELECTROLYTE.water,
      coke: coke(0.12375),
      bananas: 0.15,
      oranges: 0.075,
      watermelon: 0.009,
      lollies: 0.007,
    },
  },
  { station: 'Wonderland Trailhead', perRunner: { water: 1, electrolyte: ELECTROLYTE.water, lollies: 0.007 } },
];

const GPT6K: FoodStation[] = [
  { station: 'Wonderland Trailhead', perRunner: { water: 1, electrolyte: ELECTROLYTE.water, lollies: 0.007 } },
];

/** One race's rules, with the block's flat amounts only where `flats` is set. */
function foodLines(race: string, stations: FoodStation[], flats = true): HounslowFoodLine[] {
  const lines: HounslowFoodLine[] = [];
  for (const { station, perRunner, flat = {} } of stations) {
    for (const key of Object.keys(FOOD_SKU) as FoodKey[]) {
      const rate = Math.round((perRunner[key] ?? 0) * 1e6) / 1e6;
      const flatQty = flats ? (flat[key] ?? 0) : 0;
      if (rate > 0 || flatQty > 0) lines.push({ station, race, sku: FOOD_SKU[key], perRunner: rate, flatQty });
    }
  }
  return lines;
}

export const GPT_CONSUMPTION: HounslowFoodLine[] = [
  ...foodLines('Miler', MILER),
  ...foodLines('50k', STAGE_1),
  ...foodLines('Stage 1', STAGE_1, false),
  ...foodLines('Stage 2', STAGE_2),
  ...foodLines('Stage 3', STAGE_3),
  ...foodLines('33k', STAGE_4),
  ...foodLines('Stage 4', STAGE_4, false),
  ...foodLines('5k Family', KIDS_AND_FAMILY),
  ...foodLines('2k Kids', KIDS_AND_FAMILY),
  ...foodLines('GPT14k', GPT14K),
  ...foodLines('GPT6k', GPT6K),
];
