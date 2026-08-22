import { db, getSettings } from './db';
import { create, createMany, update } from './repo';
import { prefixFor } from '../domain/codes';
import type { AccessType, DestinationType, Item, Unit } from './types';

/**
 * Demo dataset.
 *
 * A brand new install opens on a worked example rather than an empty shell: one
 * race a fortnight out and mid-pack, one in planning, one just finished. It is
 * modelled on how a SingleTrack race actually gets loaded out, so the crew can
 * see what the app expects before entering their own gear. Settings → Data has
 * a "clear demo data" button once they are ready to start for real.
 */

/**
 * A stable id for a demo record.
 *
 * Two phones each seed their own copy of the demo data, and sync then merges
 * both — which doubled every item and template. Deriving the ids from the
 * content instead of generating random ones makes the two copies identical, so
 * they merge into one set rather than piling up. It also makes "remove the demo
 * data" a matter of matching a prefix.
 */
export function demoId(kind: string, key: string): string {
  return `demo-${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** True for anything created by the demo seed. */
export function isDemoId(id: string): boolean {
  return id.startsWith('demo-');
}

/**
 * A stable crate code for demo packlists, so both phones print the same label.
 * Four base-36 characters, matching the format of a real generated code.
 */
function demoCode(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 1_679_616;
  return `${prefixFor(name)}-${hash.toString(36).toUpperCase().padStart(4, '4')}`;
}

/** ISO date N days from today, for demo events that always look current. */
function dateIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

interface SeedItem {
  name: string;
  sku: string;
  unit: Unit;
  packSize?: number;
  bin: string;
  qty: number;
  min: number;
  consumable?: boolean;
  notes?: string;
}

const CATALOGUE: Array<{ category: string; icon: string; items: SeedItem[] }> = [
  {
    category: 'Hydration',
    icon: '💧',
    items: [
      { name: 'Water cube 20L (filled)', sku: 'HYD-CUBE20', unit: 'each', bin: 'A1', qty: 24, min: 18 },
      { name: 'Jerry can 20L (empty)', sku: 'HYD-JERRY20', unit: 'each', bin: 'A1', qty: 16, min: 10 },
      { name: 'Tailwind 50-serve tub', sku: 'HYD-TW50', unit: 'each', bin: 'B2', qty: 9, min: 6, consumable: true },
      { name: 'Electrolyte tabs (tube of 10)', sku: 'HYD-ETAB', unit: 'pack', packSize: 10, bin: 'B2', qty: 30, min: 20, consumable: true },
      { name: 'Serving jug 2L', sku: 'HYD-JUG2', unit: 'each', bin: 'A2', qty: 22, min: 16 },
      { name: 'Compostable cup 200ml', sku: 'HYD-CUP', unit: 'carton', packSize: 1000, bin: 'C1', qty: 6, min: 4, consumable: true, notes: 'Cupless events: leave in the shed.' },
      { name: 'Tap / hose fitting kit', sku: 'HYD-TAP', unit: 'each', bin: 'A2', qty: 12, min: 8 },
    ],
  },
  {
    category: 'Nutrition',
    icon: '🍌',
    items: [
      { name: 'Energy gel (box of 24)', sku: 'NUT-GEL24', unit: 'box', packSize: 24, bin: 'B1', qty: 14, min: 10, consumable: true },
      { name: 'Salted chips (box of 40)', sku: 'NUT-CHIP', unit: 'box', packSize: 40, bin: 'B1', qty: 8, min: 6, consumable: true },
      { name: 'Snakes / lollies 1kg', sku: 'NUT-LOLLY', unit: 'bag', bin: 'B1', qty: 18, min: 12, consumable: true },
      { name: 'Pretzels 500g', sku: 'NUT-PRTZ', unit: 'bag', bin: 'B1', qty: 20, min: 12, consumable: true },
      { name: 'Coke 1.25L', sku: 'NUT-COKE', unit: 'each', bin: 'B3', qty: 36, min: 24, consumable: true },
      { name: 'Bananas (per kg)', sku: 'NUT-BAN', unit: 'kg', bin: 'Chiller', qty: 0, min: 0, consumable: true, notes: 'Bought fresh on the Thursday — never held in stock.' },
      { name: 'Watermelon (whole)', sku: 'NUT-MELON', unit: 'each', bin: 'Chiller', qty: 0, min: 0, consumable: true, notes: 'Fresh purchase.' },
      { name: 'Boiled potatoes + salt (tub)', sku: 'NUT-SPUD', unit: 'each', bin: 'Chiller', qty: 0, min: 0, consumable: true },
    ],
  },
  {
    category: 'Aid station kit',
    icon: '⛺',
    items: [
      { name: 'Gazebo 3×3 (in bag)', sku: 'AID-GAZ33', unit: 'each', bin: 'D1', qty: 11, min: 8 },
      { name: 'Gazebo weight 15kg', sku: 'AID-WGT', unit: 'each', bin: 'D1', qty: 32, min: 24 },
      { name: 'Trestle table 1.8m', sku: 'AID-TBL18', unit: 'each', bin: 'D2', qty: 18, min: 14 },
      { name: 'Camp chair', sku: 'AID-CHAIR', unit: 'each', bin: 'D2', qty: 26, min: 20 },
      { name: 'Esky 60L', sku: 'AID-ESKY60', unit: 'each', bin: 'D3', qty: 10, min: 8 },
      { name: 'Tarpaulin 3×4', sku: 'AID-TARP', unit: 'each', bin: 'D3', qty: 14, min: 10 },
      { name: 'Serving tongs', sku: 'AID-TONG', unit: 'each', bin: 'C2', qty: 40, min: 30 },
      { name: 'Nitrile gloves (box of 100)', sku: 'AID-GLOVE', unit: 'box', packSize: 100, bin: 'C2', qty: 12, min: 10, consumable: true },
      { name: 'Hand sanitiser 500ml', sku: 'AID-SAN', unit: 'each', bin: 'C2', qty: 16, min: 12, consumable: true },
      { name: 'Bin bag 240L (roll of 25)', sku: 'AID-BAG240', unit: 'roll', packSize: 25, bin: 'C3', qty: 9, min: 8, consumable: true },
      { name: 'Wheelie bin 240L', sku: 'AID-BIN', unit: 'each', bin: 'Yard', qty: 8, min: 6 },
      { name: 'Paper towel (pack of 6)', sku: 'AID-TOWEL', unit: 'pack', packSize: 6, bin: 'C3', qty: 11, min: 8, consumable: true },
    ],
  },
  {
    category: 'Course marking',
    icon: '🚩',
    items: [
      { name: 'Bunting 100m roll', sku: 'CRS-BUNT', unit: 'roll', bin: 'E1', qty: 22, min: 15 },
      { name: 'Directional arrow (corflute)', sku: 'CRS-ARROW', unit: 'each', bin: 'E1', qty: 180, min: 120 },
      { name: 'Marker flag (pack of 25)', sku: 'CRS-FLAG', unit: 'pack', packSize: 25, bin: 'E2', qty: 16, min: 10 },
      { name: 'Reflective tape roll', sku: 'CRS-REFL', unit: 'roll', bin: 'E2', qty: 24, min: 18, consumable: true },
      { name: 'Danger / hazard tape roll', sku: 'CRS-DNGR', unit: 'roll', bin: 'E2', qty: 14, min: 10, consumable: true },
      { name: 'Star picket 1.2m', sku: 'CRS-PICKET', unit: 'each', bin: 'Yard', qty: 90, min: 60 },
      { name: 'Cable ties 200mm (bag of 500)', sku: 'CRS-TIE200', unit: 'bag', packSize: 500, bin: 'E3', qty: 7, min: 6, consumable: true },
    ],
  },
  {
    category: 'Medical & safety',
    icon: '🚑',
    items: [
      { name: 'First aid kit — aid station', sku: 'MED-FAK', unit: 'each', bin: 'F1', qty: 12, min: 10 },
      { name: 'Snake bite kit', sku: 'MED-SNAKE', unit: 'each', bin: 'F1', qty: 14, min: 12 },
      { name: 'Space blanket', sku: 'MED-BLNK', unit: 'each', bin: 'F1', qty: 120, min: 80, consumable: true },
      { name: 'Defibrillator', sku: 'MED-AED', unit: 'each', bin: 'F2', qty: 3, min: 3, notes: 'Check pad expiry before every event.' },
      { name: 'Sunscreen 1L pump', sku: 'MED-SUN', unit: 'each', bin: 'F2', qty: 10, min: 8, consumable: true },
      { name: 'Sharps container', sku: 'MED-SHRP', unit: 'each', bin: 'F2', qty: 6, min: 4 },
    ],
  },
  {
    category: 'Comms & power',
    icon: '📻',
    items: [
      { name: 'UHF radio (charged)', sku: 'COM-UHF', unit: 'each', bin: 'G1', qty: 22, min: 18, notes: 'Charge Wednesday night before load-out.' },
      { name: 'Radio spare battery', sku: 'COM-BATT', unit: 'each', bin: 'G1', qty: 26, min: 20 },
      { name: 'Satellite phone', sku: 'COM-SAT', unit: 'each', bin: 'G1', qty: 4, min: 4 },
      { name: 'Generator 2kVA', sku: 'PWR-GEN2', unit: 'each', bin: 'Yard', qty: 3, min: 2 },
      { name: 'Power bank 20000mAh', sku: 'PWR-BANK', unit: 'each', bin: 'G2', qty: 14, min: 10 },
      { name: 'Extension lead 15m', sku: 'PWR-EXT15', unit: 'each', bin: 'G2', qty: 12, min: 8 },
      { name: 'Head torch', sku: 'COM-TORCH', unit: 'each', bin: 'G2', qty: 20, min: 16 },
    ],
  },
  {
    category: 'Signage & timing',
    icon: '🏁',
    items: [
      { name: 'Aid station A-frame sign', sku: 'SGN-AFRAME', unit: 'each', bin: 'H1', qty: 14, min: 12 },
      { name: 'Feather flag + base', sku: 'SGN-FEATH', unit: 'each', bin: 'H1', qty: 10, min: 8 },
      { name: 'Finish arch (inflatable)', sku: 'SGN-ARCH', unit: 'each', bin: 'H2', qty: 1, min: 1 },
      { name: 'Mesh banner 3m', sku: 'SGN-MESH3', unit: 'each', bin: 'H2', qty: 8, min: 6 },
      { name: 'Timing mat', sku: 'TIM-MAT', unit: 'each', bin: 'H3', qty: 6, min: 6 },
      { name: 'Bib box (500 bibs)', sku: 'TIM-BIB', unit: 'each', bin: 'H3', qty: 4, min: 2 },
      { name: 'Clipboard + runner list', sku: 'TIM-CLIP', unit: 'each', bin: 'H3', qty: 18, min: 14 },
    ],
  },
];

interface SeedDestination {
  name: string;
  type: DestinationType;
  km: number | null;
  access: AccessType;
  accessNotes: string;
  lead: string;
  open: string;
  close: string;
}

const BUFFALO_DESTINATIONS: SeedDestination[] = [
  {
    name: 'Event Village — Bright',
    type: 'event_village',
    km: null,
    access: '2wd',
    accessNotes: 'Howitt Park, gate off Delany Ave. Truck can back onto the grass if dry.',
    lead: 'Jess Nolan',
    open: '05:00',
    close: '18:00',
  },
  {
    name: 'Start / Finish Chute',
    type: 'start',
    km: 0,
    access: '2wd',
    accessNotes: 'Set up Friday afternoon. Arch needs the generator.',
    lead: 'Jess Nolan',
    open: '05:30',
    close: '17:30',
  },
  {
    name: 'Aid 1 — Mystic Hill',
    type: 'aid_station',
    km: 8,
    access: '4wd',
    accessNotes: 'Up Mystic Lane, gate code 4821. Turn the truck at the paraglider ramp.',
    lead: 'Tom Reilly',
    open: '06:00',
    close: '11:00',
  },
  {
    name: 'Aid 2 — Eurobin Creek',
    type: 'aid_station',
    km: 24,
    access: '2wd',
    accessNotes: 'Roadside pull-in off the Great Alpine Rd. Traffic control cones required.',
    lead: 'Priya Shah',
    open: '06:30',
    close: '14:00',
  },
  {
    name: 'Aid 3 — Buffalo Plateau',
    type: 'aid_station',
    km: 42,
    access: '4wd',
    accessNotes: 'Snow gates may be closed — call the ranger Friday. 45 min from the village.',
    lead: 'Dan Whitmore',
    open: '07:00',
    close: '16:00',
  },
  {
    name: 'Aid 4 — Bakers Gully',
    type: 'aid_station',
    km: 58,
    access: 'atv',
    accessNotes: 'Quad only from the fire trail junction. Two trips to get a full station in.',
    lead: 'Alex Kerr',
    open: '08:00',
    close: '17:00',
  },
  {
    name: 'Water drop — Clearspot',
    type: 'water_drop',
    km: 33,
    access: 'foot',
    accessNotes: '900m walk-in. Two people to carry the cubes.',
    lead: 'Alex Kerr',
    open: '07:00',
    close: '16:00',
  },
];

/** Template contents keyed by SKU, so the seed reads like a real packlist. */
const TEMPLATES: Array<{
  name: string;
  appliesTo: DestinationType;
  description: string;
  lines: Array<[sku: string, qty: number, mandatory?: boolean]>;
}> = [
  {
    name: 'Standard aid station (up to 200 runners)',
    appliesTo: 'aid_station',
    description: 'The default vehicle-accessible station: water, food, shelter, bins, comms.',
    lines: [
      ['HYD-CUBE20', 4, true],
      ['HYD-JUG2', 3],
      ['HYD-TW50', 1],
      ['NUT-GEL24', 1],
      ['NUT-CHIP', 1],
      ['NUT-LOLLY', 2],
      ['NUT-PRTZ', 2],
      ['NUT-COKE', 3],
      ['AID-GAZ33', 1, true],
      ['AID-WGT', 4, true],
      ['AID-TBL18', 2],
      ['AID-CHAIR', 2],
      ['AID-ESKY60', 1],
      ['AID-TONG', 4],
      ['AID-GLOVE', 1, true],
      ['AID-SAN', 1, true],
      ['AID-BAG240', 1, true],
      ['AID-BIN', 1],
      ['AID-TOWEL', 1],
      ['MED-FAK', 1, true],
      ['MED-SNAKE', 1, true],
      ['MED-BLNK', 4, true],
      ['COM-UHF', 2, true],
      ['COM-BATT', 2],
      ['SGN-AFRAME', 1],
      ['TIM-CLIP', 1, true],
    ],
  },
  {
    name: 'Remote station — 4WD / quad access',
    appliesTo: 'aid_station',
    description: 'Pared back to what fits on a quad, with the safety kit non-negotiable.',
    lines: [
      ['HYD-CUBE20', 3, true],
      ['HYD-JUG2', 2],
      ['NUT-GEL24', 1],
      ['NUT-LOLLY', 1],
      ['NUT-PRTZ', 1],
      ['AID-TARP', 1],
      ['AID-TBL18', 1],
      ['AID-TONG', 2],
      ['AID-GLOVE', 1, true],
      ['AID-BAG240', 1, true],
      ['MED-FAK', 1, true],
      ['MED-SNAKE', 1, true],
      ['MED-BLNK', 6, true],
      ['COM-UHF', 2, true],
      ['COM-BATT', 2, true],
      ['COM-SAT', 1, true],
      ['TIM-CLIP', 1, true],
    ],
  },
  {
    name: 'Event village core',
    appliesTo: 'event_village',
    description: 'Registration, finish line and bump-in kit for the village.',
    lines: [
      ['SGN-ARCH', 1, true],
      ['SGN-FEATH', 4],
      ['SGN-MESH3', 3],
      ['TIM-MAT', 2, true],
      ['TIM-BIB', 1, true],
      ['TIM-CLIP', 4],
      ['AID-GAZ33', 3, true],
      ['AID-WGT', 12, true],
      ['AID-TBL18', 6],
      ['AID-CHAIR', 8],
      ['AID-BIN', 3],
      ['AID-BAG240', 2],
      ['PWR-GEN2', 1, true],
      ['PWR-EXT15', 3],
      ['COM-UHF', 6, true],
      ['MED-FAK', 1, true],
      ['MED-AED', 1, true],
      ['MED-SUN', 2],
    ],
  },
  {
    name: 'Water-only drop',
    appliesTo: 'water_drop',
    description: 'Unstaffed cube drop with signage and a bin.',
    lines: [
      ['HYD-CUBE20', 3, true],
      ['HYD-JUG2', 1],
      ['SGN-AFRAME', 1, true],
      ['AID-BAG240', 1],
      ['CRS-DNGR', 1],
    ],
  },
];

/** Populate an empty database. Safe to call on every boot — it exits if seeded. */
export async function ensureSeeded(): Promise<void> {
  try {
    const settings = await getSettings();
    if (settings.seeded) return;
    const existing = await db.items.count();
    if (existing > 0) {
      await update(db.settings, settings.id, { seeded: true });
      return;
    }
    await seedDemoData();
    await update(db.settings, settings.id, { seeded: true, crewName: 'Warehouse' });
  } catch (cause) {
    // A seeding failure must never stop the app from opening.
    console.error('Demo data could not be created', cause);
  }
}

export async function seedDemoData(): Promise<void> {
  const skuToItem = new Map<string, Item>();

  for (const [index, group] of CATALOGUE.entries()) {
    const category = await create(db.categories, {
      id: demoId('cat', group.category),
      name: group.category,
      sort: (index + 1) * 10,
      icon: group.icon,
    });
    const items = await createMany(
      db.items,
      group.items.map((item) => ({
        id: demoId('item', item.sku),
        name: item.name,
        sku: item.sku,
        categoryId: category.id,
        unit: item.unit,
        packSize: item.packSize ?? 1,
        bin: item.bin,
        qtyOnHand: item.qty,
        minQty: item.min,
        barcode: null,
        notes: item.notes ?? '',
        consumable: item.consumable ?? false,
        archived: false,
      })),
    );
    items.forEach((item) => skuToItem.set(item.sku, item));
  }

  // Opening balances, so the ledger is not empty on day one.
  await createMany(
    db.movements,
    [...skuToItem.values()]
      .filter((item) => item.qtyOnHand > 0)
      .map((item) => ({
        id: demoId('mv', item.sku),
        itemId: item.id,
        qty: item.qtyOnHand,
        reason: 'receipt' as const,
        balanceAfter: item.qtyOnHand,
        refType: 'seed' as const,
        refId: null,
        note: 'Opening balance',
        by: 'Warehouse',
      })),
  );

  for (const spec of TEMPLATES) {
    const template = await create(db.templates, {
      id: demoId('tpl', spec.name),
      name: spec.name,
      appliesTo: spec.appliesTo,
      description: spec.description,
    });
    await createMany(
      db.templateLines,
      spec.lines
        .filter(([sku]) => skuToItem.has(sku))
        .map(([sku, qty, mandatory], index) => ({
          id: demoId('tline', `${spec.name}-${sku}`),
          templateId: template.id,
          itemId: skuToItem.get(sku)!.id,
          qty,
          mandatory: mandatory ?? false,
          perRunner: false,
          note: '',
          sort: (index + 1) * 10,
        })),
    );
  }

  const buffalo = await create(db.events, {
    id: demoId('event', 'Buffalo Stampede'),
    name: 'Buffalo Stampede',
    location: 'Bright, VIC',
    startDate: dateIn(12),
    endDate: dateIn(13),
    status: 'packing',
    notes: 'Skymarathon, 42km, 26km and 10km. Plateau station depends on the snow gates.',
  });

  await create(db.events, {
    id: demoId('event', 'Hounslow Classic'),
    name: 'Hounslow Classic',
    location: 'Blue Mountains, NSW',
    startDate: dateIn(68),
    endDate: dateIn(68),
    status: 'planning',
    notes: 'Interstate — everything goes up in the truck on the Wednesday.',
  });

  await create(db.events, {
    id: demoId('event', 'Roller Coaster Run'),
    name: 'Roller Coaster Run',
    location: 'Mount Dandenong, VIC',
    startDate: dateIn(-38),
    endDate: dateIn(-38),
    status: 'debrief',
    notes: 'Returns reconciled. Two gazebos went back with broken legs.',
  });

  const destinations = await createMany(
    db.destinations,
    BUFFALO_DESTINATIONS.map((destination, index) => ({
      id: demoId('dest', destination.name),
      eventId: buffalo.id,
      name: destination.name,
      type: destination.type,
      courseKm: destination.km,
      access: destination.access,
      accessNotes: destination.accessNotes,
      lat: null,
      lng: null,
      crewLead: destination.lead,
      phone: '',
      openTime: destination.open,
      closeTime: destination.close,
      notes: '',
      sort: (index + 1) * 10,
    })),
  );

  // Build packlists for the two aid stations that are furthest along, so the
  // demo shows a part-packed list and a fully packed one side by side.
  const templates = await db.templates.toArray();
  const templateLines = await db.templateLines.toArray();

  for (const destination of destinations) {
    const template =
      templates.find((entry) => entry.appliesTo === destination.type) ??
      templates.find((entry) => entry.appliesTo === 'aid_station')!;
    const lines = templateLines.filter((line) => line.templateId === template.id);
    if (!lines.length) continue;

    const packlist = await create(db.packlists, {
      id: demoId('pl', destination.name),
      eventId: buffalo.id,
      destinationId: destination.id,
      name: destination.name,
      // Deterministic too, so both phones print the same label for it.
      code: demoCode(destination.name),
      status: 'draft',
      packedBy: '',
      packedAt: null,
      deliveredAt: null,
      receivedBy: '',
      notes: '',
    });

    // Village and first aid station are packed; the rest are still to pick.
    const packedFully = destination.type === 'event_village' || destination.name.includes('Aid 1');
    const partly = destination.name.includes('Aid 2');

    await createMany(
      db.packlistLines,
      lines.map((line, index) => ({
        id: demoId('plline', `${destination.name}-${line.itemId}`),
        packlistId: packlist.id,
        itemId: line.itemId,
        qtyRequired: line.qty,
        qtyPacked: packedFully ? line.qty : partly && index % 3 !== 0 ? line.qty : 0,
        qtyReturned: 0,
        mandatory: line.mandatory,
        containerId: null,
        note: line.note,
        sort: line.sort,
      })),
    );

    if (packedFully) {
      await update(db.packlists, packlist.id, {
        status: 'packed',
        packedBy: 'Warehouse',
        packedAt: new Date().toISOString(),
      });
    } else if (partly) {
      await update(db.packlists, packlist.id, { status: 'picking' });
    }
  }

  const load = await create(db.loads, {
    id: demoId('load', 'run-1'),
    eventId: buffalo.id,
    name: 'Run 1 — village + low stations',
    vehicle: '6m Truck',
    driver: 'Dan Whitmore',
    phone: '0400 000 000',
    status: 'planned',
    departAt: `${dateIn(11)}T06:30:00`,
    departedAt: null,
    completedAt: null,
    notes: 'Village first, then Mystic and Eurobin on the way through.',
  });

  await createMany(
    db.loadStops,
    destinations.slice(0, 4).map((destination, index) => ({
      id: demoId('stop', destination.name),
      loadId: load.id,
      destinationId: destination.id,
      sort: (index + 1) * 10,
      arrivedAt: null,
      signedBy: '',
      notes: '',
    })),
  );
}
