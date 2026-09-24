import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, liveWhere } from '../db/repo';
import { interpretGrids } from './importGrid';
import type { Grid } from './importGrid';
import { buildPlan, commitImport } from './packlistImport';
import type { ImportPlan } from './packlistImport';
import { createPacklist, addLine } from './packlists';
import type { Destination, Item, RaceEvent } from '../db/types';

async function makeEvent(): Promise<RaceEvent> {
  return create(db.events, {
    name: 'Hounslow Classic 2026',
    location: 'Blackheath',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    status: 'packing',
    notes: '',
  });
}

async function makeDestination(eventId: string, name: string, type: Destination['type'] = 'aid_station') {
  return create(db.destinations, {
    eventId,
    name,
    type,
    courseKm: null,
    access: '2wd',
    accessNotes: '',
    lat: null,
    lng: null,
    crewLead: '',
    phone: '',
    openTime: '06:00',
    closeTime: '16:00',
    notes: '',
    sort: 10,
  });
}

async function makeItem(name: string, sku: string, categoryId: string | null = null): Promise<Item> {
  return create(db.items, {
    name,
    sku,
    categoryId,
    unit: 'each',
    packSize: 1,
    bin: '',
    qtyOnHand: 10,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
  });
}

const SHEET: Grid = {
  name: 'Run sheet',
  rows: [
    ['Item', 'GC Carpark', 'Perrys', 'Village', 'Total'],
    ['STRUCTURE', '', '', '', ''],
    ['Marquee 3x3', '2', '2', '4', '8'],
    ['Trestle table', '4', '4', '10', '18'],
    ['Trestle Tables', '', '2', '', '2'],
    ['COOKING', '', '', '', ''],
    ['Electric kettle', '', '1', '', '1'],
    ['Helicopter fuel drum', '', '', '1', '1'],
    ['Heli fuel drum', '', '', '1', '1'],
  ],
};

async function setUp() {
  const event = await makeEvent();
  const carpark = await makeDestination(event.id, 'Grand Canyon Carpark');
  const perrys = await makeDestination(event.id, 'Perrys Lookdown');
  const village = await makeDestination(event.id, 'Allview Escape', 'event_village');
  const cooking = await create(db.categories, { name: 'Cooking & Heating', sort: 10, icon: '🔥' });
  const structure = await create(db.categories, { name: 'Structure & Shelter', sort: 20, icon: '⛺' });
  const marquee = await makeItem('Marquee - ST 3x3 (or equivalent)', 'STR-02', structure.id);
  const tables = await makeItem('Trestle Tables', 'FRN-01');
  const kettle = await makeItem('Kettle - Electric', 'CKG-02', cooking.id);
  await makeItem('Kettle - Stove Top', 'CKG-03', cooking.id);
  return { event, carpark, perrys, village, cooking, structure, marquee, tables, kettle };
}

/** Plan against whatever is in the database right now, as the screen does. */
async function planAgainst(eventId: string, grids: Grid[]) {
  const destinations = await liveWhere(db.destinations, 'eventId', eventId);
  const items = await db.items.toArray();
  const categories = await db.categories.toArray();
  const parsed = interpretGrids(grids, {
    placeNames: destinations.map((destination) => destination.name),
    categoryNames: categories.map((category) => category.name),
  });
  return buildPlan(parsed, { eventId, destinations, items, categories });
}

async function planFor(grids: Grid[] = [SHEET]) {
  const world = await setUp();
  const plan = await planAgainst(world.event.id, grids);
  return { ...world, plan };
}

describe('buildPlan', () => {
  it('maps each column heading to a destination once', async () => {
    const { plan, carpark, perrys, village } = await planFor();
    expect(plan.places.map((place) => [place.heading, place.action, place.destinationId])).toEqual([
      ['GC Carpark', 'existing', carpark.id],
      ['Perrys', 'existing', perrys.id],
      ['Village', 'existing', village.id],
    ]);
    expect(plan.places.every((place) => place.guessed)).toBe(true);
  });

  it('folds two spellings of one item into one line with the quantities summed', async () => {
    const { plan, tables } = await planFor();
    const line = plan.items.find((item) => item.itemId === tables.id);
    expect(line).toBeDefined();
    expect(line?.alsoWritten).toEqual(['Trestle Tables']);
    expect(line?.quantities).toEqual([
      { place: 'GC Carpark', qty: 4 },
      { place: 'Perrys', qty: 6 },
      { place: 'Village', qty: 10 },
    ]);
    expect(line?.totalQty).toBe(20);
    expect(plan.items.filter((item) => item.itemId === tables.id)).toHaveLength(1);
  });

  it('matches by meaning and reports how sure it is', async () => {
    const { plan, marquee, kettle } = await planFor();
    const byId = new Map(plan.items.map((item) => [item.itemId, item]));
    expect(byId.get(marquee.id)?.confidence).toBe('likely');
    expect(byId.get(kettle.id)?.confidence).toBe('sure');
  });

  it('plans to create what the catalogue lacks, guessing the category from the section', async () => {
    const { plan, cooking } = await planFor();
    const fresh = plan.items.filter((item) => item.action === 'create');
    expect(fresh.map((item) => item.name)).toEqual(['Helicopter fuel drum', 'Heli fuel drum']);
    expect(fresh[0].section).toBe('COOKING');
    expect(fresh[0].categoryId).toBe(cooking.id);
  });

  it('guesses a category when the section names one', async () => {
    const grid: Grid = {
      name: 'Sheet1',
      rows: [['Item', 'Qty'], ['Cooking & Heating', ''], ['Camp oven', '1']],
    };
    const { plan, cooking } = await planFor([grid]);
    expect(plan.items[0]).toMatchObject({ name: 'Camp oven', action: 'create', categoryId: cooking.id });
  });

  it('leaves an unrecognised heading for a person when the event has stations', async () => {
    const grid: Grid = { name: 'Sheet1', rows: [['Item', 'Mystery Ridge'], ['Kettle', '1'], ['Wok', '2']] };
    const { plan } = await planFor([grid]);
    expect(plan.places[0]).toMatchObject({ heading: 'Mystery Ridge', action: 'skip', destinationId: null });
  });

  it('defaults to creating stations for an event that has none yet', async () => {
    const event = await makeEvent();
    const parsed = interpretGrids([{ name: 'Sheet1', rows: [['Item', 'Aid 1', 'Aid 2'], ['Kettle', '1', '1']] }]);
    const plan = buildPlan(parsed, { eventId: event.id, destinations: [], items: [], categories: [] });
    expect(plan.places.map((place) => place.action)).toEqual(['create', 'create']);
  });

  it('points an unplaced list at the only destination there is', async () => {
    const event = await makeEvent();
    const only = await makeDestination(event.id, 'Summit');
    const parsed = interpretGrids([{ name: 'Sheet1', rows: [['Item', 'Qty'], ['Kettle', '1']] }]);
    const plan = buildPlan(parsed, { eventId: event.id, destinations: [only], items: [], categories: [] });
    expect(plan.unplacedLines).toBe(1);
    expect(plan.unplacedDestinationId).toBe(only.id);
  });
});

describe('commitImport', () => {
  it('writes one line per item per station, creating packlists and items as it goes', async () => {
    const { plan, carpark, perrys, village, tables, marquee } = await planFor();
    // The reviewer decides the two fuel drum spellings are one new item.
    const [drum, drumAgain] = plan.items.filter((item) => item.action === 'create');
    drumAgain.action = 'skip';
    drum.quantities[0].qty += drumAgain.quantities[0].qty;

    const result = await commitImport(plan, { existing: 'set', source: 'run-sheet.xlsx' });
    expect(result).toMatchObject({
      destinationsCreated: 0,
      itemsCreated: 1,
      packlistsCreated: 3,
      packlistsTouched: 3,
      linesAdded: 8,
      linesUpdated: 0,
      // The spelling the reviewer folded away had nowhere to go.
      linesSkipped: 1,
    });

    const items = await db.items.toArray();
    const created = items.find((item) => item.name === 'Helicopter fuel drum');
    expect(created?.notes).toBe('Imported from run-sheet.xlsx');
    // Filed under the section it sat in, so it takes that category's next code.
    expect(created?.sku).toBe('CKG-04');

    const perrysList = (await liveWhere(db.packlists, 'destinationId', perrys.id))[0];
    const perrysLines = await liveWhere(db.packlistLines, 'packlistId', perrysList.id);
    expect(perrysLines.map((line) => [line.itemId, line.qtyRequired])).toEqual(
      expect.arrayContaining([
        [marquee.id, 2],
        [tables.id, 6],
      ]),
    );
    expect(perrysLines).toHaveLength(3);

    const villageList = (await liveWhere(db.packlists, 'destinationId', village.id))[0];
    const villageLines = await liveWhere(db.packlistLines, 'packlistId', villageList.id);
    expect(villageLines.find((line) => line.itemId === created?.id)?.qtyRequired).toBe(2);

    const carparkList = (await liveWhere(db.packlists, 'destinationId', carpark.id))[0];
    expect(await liveWhere(db.packlistLines, 'packlistId', carparkList.id)).toHaveLength(2);
  });

  it('gives a new item the next SKU in its category', async () => {
    const grid: Grid = { name: 'Sheet1', rows: [['Item', 'Qty'], ['Cooking & Heating', ''], ['Camp oven', '1'], ['Wok', '1']] };
    const { plan, perrys } = await planFor([grid]);
    plan.unplacedDestinationId = perrys.id;
    await commitImport(plan, { existing: 'set', source: 'list.csv' });
    const items = await db.items.toArray();
    expect(items.find((item) => item.name === 'Camp oven')?.sku).toBe('CKG-04');
    expect(items.find((item) => item.name === 'Wok')?.sku).toBe('CKG-05');
  });

  it('merges into an existing line rather than adding a second, and is idempotent', async () => {
    const { plan, event, perrys, tables } = await planFor();
    const packlist = await createPacklist(await db.destinations.get(perrys.id) as Destination);
    await addLine(packlist.id, tables.id, 1);

    const first = await commitImport(plan, { existing: 'set', source: 'run-sheet.xlsx' });
    expect(first.linesUpdated).toBe(1);
    expect(first.packlistsCreated).toBe(2);
    let lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    expect(lines.filter((line) => line.itemId === tables.id)).toHaveLength(1);
    expect(lines.find((line) => line.itemId === tables.id)?.qtyRequired).toBe(6);

    // The same file again: it now matches the items the first run created.
    const rerun = await planAgainst(event.id, [SHEET]);
    expect(rerun.items.every((item) => item.action === 'existing')).toBe(true);
    const again = await commitImport(rerun, { existing: 'set', source: 'run-sheet.xlsx' });
    expect(again.itemsCreated).toBe(0);
    expect(again.linesAdded).toBe(0);
    expect(again.linesUpdated).toBe(0);
    expect(again.linesUnchanged).toBeGreaterThan(0);
    lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    expect(lines.filter((line) => line.itemId === tables.id)).toHaveLength(1);
  });

  it('can add to what is already required instead', async () => {
    const { plan, perrys, tables } = await planFor();
    const packlist = await createPacklist(await db.destinations.get(perrys.id) as Destination);
    await addLine(packlist.id, tables.id, 1);
    await commitImport(plan, { existing: 'add', source: '' });
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    expect(lines.find((line) => line.itemId === tables.id)?.qtyRequired).toBe(7);
  });

  it('creates a destination when asked to, and skips a heading when told to', async () => {
    const grid: Grid = { name: 'Sheet1', rows: [['Item', 'Mystery Ridge', 'Ignore me'], ['Kettle', '1', '2']] };
    const { plan, event } = await planFor([grid]);
    plan.places[0].action = 'create';
    plan.places[1].action = 'skip';
    const result = await commitImport(plan, { existing: 'set', source: '' });
    expect(result.destinationsCreated).toBe(1);
    expect(result.linesSkipped).toBe(1);
    const destinations = await liveWhere(db.destinations, 'eventId', event.id);
    const ridge = destinations.find((destination) => destination.name === 'Mystery Ridge');
    expect(ridge?.type).toBe('aid_station');
    const list = (await liveWhere(db.packlists, 'destinationId', ridge!.id))[0];
    expect(await liveWhere(db.packlistLines, 'packlistId', list.id)).toHaveLength(1);
  });

  it('folds two headings mapped to the same destination into one packlist', async () => {
    const grid: Grid = { name: 'Sheet1', rows: [['Item', 'Perrys', 'Perrys Lookdown'], ['Kettle', '1', '2']] };
    const { plan, perrys } = await planFor([grid]);
    for (const place of plan.places) {
      place.action = 'existing';
      place.destinationId = perrys.id;
    }
    const result = await commitImport(plan, { existing: 'set', source: '' });
    expect(result.linesAdded).toBe(1);
    const list = (await liveWhere(db.packlists, 'destinationId', perrys.id))[0];
    const lines = await liveWhere(db.packlistLines, 'packlistId', list.id);
    expect(lines[0].qtyRequired).toBe(3);
  });

  it('skips unplaced lines when no destination was chosen', async () => {
    const grid: Grid = { name: 'Sheet1', rows: [['Item', 'Qty'], ['Kettle', '1']] };
    const { plan } = await planFor([grid]);
    const plain: ImportPlan = { ...plan, unplacedDestinationId: null };
    const result = await commitImport(plain, { existing: 'set', source: '' });
    expect(result.linesSkipped).toBe(1);
    expect(result.packlistsTouched).toBe(0);
  });
});
