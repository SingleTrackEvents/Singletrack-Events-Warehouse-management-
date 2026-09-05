import { describe, expect, it } from 'vitest';
import { db, getSettings } from './db';
import { alive, softDelete, update } from './repo';
import { ensureSeeded, seedStarterData } from './seed';
import { lineQtyByDay } from '../domain/consumption';
import { CATALOGUE, EVENT_LISTS } from './catalogue';
import { EVENT_SEED } from './eventSeed';
import { EXTRA_ITEMS } from './extrasCatalogue';
import { FOOD_CATALOGUE, FOOD_CATEGORY } from './foodCatalogue';
import { HOUNSLOW_CONSUMPTION, HOUNSLOW_PACKLISTS } from './hounslowSeed';
import { KIT_CONTENTS } from './kitContents';
import { STATION_TEMPLATES } from './stationTemplates';
import type { AccessType, DestinationType, SyncMeta, Template } from './types';

describe('the starting catalogue', () => {
  it('loads the real warehouse list', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const expected =
      CATALOGUE.reduce((sum, group) => sum + group.items.length, 0) +
      FOOD_CATALOGUE.length +
      EXTRA_ITEMS.length;
    expect(await db.categories.count()).toBe(CATALOGUE.length + 1);
    expect(items).toHaveLength(expected);
    expect(items.some((item) => item.name === 'IBC Water Container (1000L)')).toBe(true);
    expect(items.some((item) => item.name === 'Starlink')).toBe(true);
  });

  it('gives every item a unique code and a category', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    expect(new Set(items.map((item) => item.sku)).size).toBe(items.length);
    expect(items.every((item) => item.categoryId !== null)).toBe(true);
  });

  it('records no quantity on hand, because the spreadsheet is not a stocktake', async () => {
    await seedStarterData();

    // Putting a figure here would look like a count and would not be one. The
    // ledger stays empty for the same reason: nothing has been received yet.
    expect(alive(await db.items.toArray()).every((item) => item.qtyOnHand === 0)).toBe(true);
    expect(await db.movements.count()).toBe(0);
  });

  it('sets the low-stock level to the largest single-event requirement', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const trestle = items.find((item) => item.name === 'Trestle Tables');
    expect(trestle?.minQty).toBe(155);
    // Everything is below its level until counted, which is the honest state.
    expect(items.filter((item) => item.minQty > 0).every((item) => item.qtyOnHand < item.minQty))
      .toBe(true);
  });

  it('builds one packing template per event', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    for (const event of EVENT_LISTS) {
      expect(templates.some((template) => template.name.startsWith(event.name))).toBe(true);
    }
  });

  it('fills each template from that event, not from the whole catalogue', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    const lines = alive(await db.templateLines.toArray());
    const gpt = templates.find((template) => template.name.startsWith('GPT100'))!;
    const baw = templates.find((template) => template.name.startsWith('Snow Gum'))!;

    const gptLines = lines.filter((line) => line.templateId === gpt.id);
    const bawLines = lines.filter((line) => line.templateId === baw.id);

    // GPT100 is the biggest list and Baw Baw the smallest, per the spreadsheet.
    expect(gptLines.length).toBeGreaterThan(bawLines.length);
    expect(bawLines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.qty > 0)).toBe(true);
  });

  it('carries the real quantities through to the template lines', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const templates = alive(await db.templates.toArray());
    const buffalo = templates.find((template) => template.name.startsWith('Buffalo Stampede'))!;
    const tables = items.find((item) => item.name === 'Trestle Tables')!;
    const line = alive(await db.templateLines.toArray()).find(
      (entry) => entry.templateId === buffalo.id && entry.itemId === tables.id,
    );

    expect(line?.qty).toBe(155);
  });

  it('every template line points at an item that exists', async () => {
    await seedStarterData();

    const ids = new Set(alive(await db.items.toArray()).map((item) => item.id));
    const lines = alive(await db.templateLines.toArray());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => ids.has(line.itemId))).toBe(true);
  });

  it('seeds the season’s events, and packlists only where a run sheet exists', async () => {
    await seedStarterData();

    expect(alive(await db.events.toArray())).toHaveLength(EVENT_SEED.length);
    // Hounslow's five stations arrive with last year's run sheets as drafts;
    // nothing is marked packed and no stock has moved.
    const packlists = alive(await db.packlists.toArray());
    expect(packlists).toHaveLength(HOUNSLOW_PACKLISTS.length);
    expect(packlists.every((packlist) => packlist.status === 'draft')).toBe(true);
    expect(await db.movements.count()).toBe(0);
  });

  it('seeding twice collapses rather than doubling', async () => {
    await seedStarterData();
    const first = alive(await db.items.toArray()).length;

    await seedStarterData();

    expect(alive(await db.items.toArray())).toHaveLength(first);
    expect(alive(await db.templates.toArray())).toHaveLength(
      EVENT_LISTS.length + STATION_TEMPLATES.length,
    );
  });

  it('only seeds once, however many times the app boots', async () => {
    await ensureSeeded();
    const first = await db.items.count();

    await ensureSeeded();
    await ensureSeeded();

    expect(await db.items.count()).toBe(first);
    expect((await getSettings()).seeded).toBe(true);
  });

  it('never writes over a database that already has stock', async () => {
    await db.items.put({
      id: 'existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      rev: 1,
      deviceId: 'test',
      syncedAt: null,
      name: 'Their own item',
      sku: 'OWN',
      categoryId: null,
      unit: 'each',
      packSize: 1,
      bin: '',
      qtyOnHand: 1,
      minQty: 0,
      barcode: null,
      notes: '',
      consumable: false,
      archived: false,
    });

    await ensureSeeded();

    // The catalogue is added alongside — the guarantee is that nothing of
    // theirs is touched, not that nothing arrives. A database with stock in it
    // and no seed marker is a restored backup or a device that has synced, and
    // in both cases the catalogue belongs there too.
    const theirs = (await db.items.get('existing'))!;
    expect(theirs.name).toBe('Their own item');
    expect(theirs.qtyOnHand).toBe(1);
    expect(theirs.rev).toBe(1);
    expect(await db.items.count()).toBeGreaterThan(1);
  });
});

describe('the seeded season', () => {
  it('carries every event with its dates, location and aid stations', async () => {
    await seedStarterData();

    const events = alive(await db.events.toArray());
    const destinations = alive(await db.destinations.toArray());
    for (const spec of EVENT_SEED) {
      const event = events.find((entry) => entry.name === spec.name);
      expect(event, spec.name).toBeDefined();
      expect(event!.startDate).toBe(spec.startDate);
      expect(event!.location).toBe(spec.location);
      const own = destinations.filter((destination) => destination.eventId === event!.id);
      expect(own, spec.name).toHaveLength(spec.destinations.length);
    }
  });

  it('places the GPT100 stations at their published kilometres', async () => {
    await seedStarterData();

    const events = alive(await db.events.toArray());
    const gpt = events.find((event) => event.name.startsWith('GPT100'))!;
    const destinations = alive(await db.destinations.toArray()).filter(
      (destination) => destination.eventId === gpt.id,
    );
    const rosea = destinations.find((destination) => destination.name === 'Rosea Carpark');
    expect(rosea?.courseKm).toBe(59);
    expect(destinations).toHaveLength(13);
  });

  it('links Hounslow’s stations to its races, double passes included', async () => {
    await seedStarterData();

    const events = alive(await db.events.toArray());
    const hounslow = events.find((event) => event.name.startsWith('Hounslow'))!;
    const races = alive(await db.races.toArray()).filter((race) => race.eventId === hounslow.id);
    expect(races.map((race) => race.name).sort()).toEqual(['17k', 'Kids', 'Marathon']);
    expect(races.find((race) => race.name === 'Marathon')?.projection).toBe(450);

    const marathon = races.find((race) => race.name === 'Marathon')!;
    const perrys = alive(await db.destinations.toArray()).find(
      (destination) => destination.name === 'Perrys Lookdown',
    )!;
    expect(perrys.raceVisits).toContainEqual({ raceId: marathon.id, passes: 2 });
  });

  it('does not resurrect an event the crew deleted', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const events = alive(await db.events.toArray());
    const razorback = events.find((event) => event.name.startsWith('Razorback'))!;
    await softDelete(db.events, razorback.id);

    await ensureSeeded();

    expect(
      alive(await db.events.toArray()).some((event) => event.name.startsWith('Razorback')),
    ).toBe(false);
  });

  it('reaches a device that seeded before events existed', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    await db.races.clear();
    await db.destinations.clear();
    await db.events.clear();

    await ensureSeeded();

    expect(alive(await db.events.toArray())).toHaveLength(EVENT_SEED.length);
  });
});

describe('the extra items the inventory sheet missed', () => {
  it('files each into its existing category, with no SKU collisions', async () => {
    const taken = new Set([
      ...CATALOGUE.flatMap((group) => group.items.map((item) => item.sku)),
      ...FOOD_CATALOGUE.map((item) => item.sku),
    ]);
    expect(EXTRA_ITEMS.every((item) => !taken.has(item.sku))).toBe(true);
    expect(new Set(EXTRA_ITEMS.map((item) => item.sku)).size).toBe(EXTRA_ITEMS.length);

    await seedStarterData();
    const categories = alive(await db.categories.toArray());
    const items = alive(await db.items.toArray());
    for (const extra of EXTRA_ITEMS) {
      const item = items.find((entry) => entry.sku === extra.sku);
      expect(item, extra.name).toBeDefined();
      const category = categories.find((entry) => entry.id === item!.categoryId);
      expect(category?.name, extra.name).toBe(extra.category);
    }
  });
});

describe('what goes in the kits', () => {
  it('fills the aid station kit from its laminated list, every line resolved', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const kit = items.find((item) => item.sku === 'KIT-01')!;
    const spec = KIT_CONTENTS.find((entry) => entry.sku === 'KIT-01')!;
    expect(kit.contents).toHaveLength(spec.contents.length);
    const ids = new Set(items.map((item) => item.id));
    expect(kit.contents!.every((content) => ids.has(content.itemId))).toBe(true);

    const jugs = items.find((item) => item.name === 'Serving Jugs (2L, marked)')!;
    expect(kit.contents!.find((content) => content.itemId === jugs.id)?.qty).toBe(4);
  });

  it('names only items the catalogue has, so nothing inside a kit is a ghost', () => {
    const known = new Set([
      ...CATALOGUE.flatMap((group) => group.items.map((item) => item.name)),
      ...FOOD_CATALOGUE.map((item) => item.name),
      ...EXTRA_ITEMS.map((item) => item.name),
    ]);
    const missing = KIT_CONTENTS.flatMap((spec) =>
      spec.contents.map(([name]) => name).filter((name) => !known.has(name)),
    );
    expect(missing).toEqual([]);
  });

  it('reaches a device that had the kit before contents existed, once', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const kit = alive(await db.items.toArray()).find((item) => item.sku === 'KIT-01')!;
    // A device from before kits: the item is there, the field is not.
    const { contents: _contents, ...withoutContents } = kit;
    await db.items.put(withoutContents as typeof kit);

    await ensureSeeded();
    expect((await db.items.get(kit.id))?.contents?.length).toBeGreaterThan(0);
  });

  it('leaves a kit the crew emptied alone', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const kit = alive(await db.items.toArray()).find((item) => item.sku === 'KIT-01')!;
    await update(db.items, kit.id, { contents: [] });

    await ensureSeeded();
    // An empty list is a decision; only "never set" is filled in.
    expect((await db.items.get(kit.id))?.contents).toEqual([]);
  });
});

describe('the Hounslow starting packlists and food plan', () => {
  it('names only items the catalogue actually has', () => {
    const known = new Set([
      ...CATALOGUE.flatMap((group) => group.items.map((item) => item.name)),
      ...FOOD_CATALOGUE.map((item) => item.name),
      ...EXTRA_ITEMS.map((item) => item.name),
    ]);
    const missing = HOUNSLOW_PACKLISTS.flatMap((list) =>
      list.lines.map((line) => line.item).filter((name) => !known.has(name)),
    );
    expect(missing).toEqual([]);

    const skus = new Set(FOOD_CATALOGUE.map((item) => item.sku));
    expect(HOUNSLOW_CONSUMPTION.every((line) => skus.has(line.sku))).toBe(true);
  });

  it('builds one draft packlist per run-sheet station, every line resolved', async () => {
    await seedStarterData();

    const packlists = alive(await db.packlists.toArray());
    const lines = alive(await db.packlistLines.toArray());
    const itemIds = new Set(alive(await db.items.toArray()).map((item) => item.id));
    for (const spec of HOUNSLOW_PACKLISTS) {
      const packlist = packlists.find((entry) => entry.name === spec.station);
      expect(packlist, spec.station).toBeDefined();
      const own = lines.filter((line) => line.packlistId === packlist!.id);
      expect(own, spec.station).toHaveLength(spec.lines.length);
      expect(own.every((line) => itemIds.has(line.itemId))).toBe(true);
      expect(own.every((line) => line.qtyPacked === 0)).toBe(true);
    }
  });

  it('carries the run-sheet quantities', async () => {
    await seedStarterData();

    const packlists = alive(await db.packlists.toArray());
    const village = packlists.find((entry) => entry.name === 'Allview Escape')!;
    const items = alive(await db.items.toArray());
    const trestles = items.find((item) => item.name === 'Trestle Tables')!;
    const line = alive(await db.packlistLines.toArray()).find(
      (entry) => entry.packlistId === village.id && entry.itemId === trestles.id,
    );
    expect(line?.qtyRequired).toBe(17);
  });

  it('reproduces the consumption sheet, station by station and day by day', async () => {
    await seedStarterData();

    const events = alive(await db.events.toArray());
    const hounslow = events.find((event) => event.name.startsWith('Hounslow'))!;
    const destinations = alive(await db.destinations.toArray()).filter(
      (destination) => destination.eventId === hounslow.id,
    );
    const races = alive(await db.races.toArray()).filter((race) => race.eventId === hounslow.id);
    const lines = alive(await db.consumptionLines.toArray());
    const bySku = new Map(alive(await db.items.toArray()).map((item) => [item.id, item.sku]));

    // Every rule for an item at a station, added up per day.
    const onDay = (station: string, sku: string, day: string) => {
      const destination = destinations.find((entry) => entry.name === station)!;
      return lines
        .filter((line) => line.destinationId === destination.id && bySku.get(line.itemId) === sku)
        .flatMap((line) => lineQtyByDay(line, destination, races))
        .filter(([when]) => when === day)
        .reduce((sum, [, qty]) => sum + qty, 0);
    };
    const SAT = '2026-09-12';
    const SUN = '2026-09-13';

    // Straight off the sheet's per-day station totals: marathon and kids Saturday, 17k Sunday.
    expect(onDay('Grand Canyon Carpark', 'FD-01', SAT)).toBe(360); // marathon water
    expect(onDay('Grand Canyon Carpark', 'FD-01', SUN)).toBe(735); // 17k water
    expect(onDay('Grand Canyon Carpark', 'FD-05', SAT)).toBe(45); // coke, 0.1 for the marathon
    expect(onDay('Grand Canyon Carpark', 'FD-05', SUN)).toBe(202); // coke, 0.33 for the 17k
    expect(onDay('Allview Escape', 'FD-01', SAT)).toBe(1800 + 80); // marathon twice + kids
    expect(onDay('Allview Escape', 'FD-01', SUN)).toBe(1224); // 17k
    expect(onDay('Perrys Lookdown', 'FD-01', SAT)).toBe(2250);
    expect(onDay('Perrys Lookdown', 'FD-01', SUN)).toBe(0); // Perrys is Saturday only
    expect(onDay('Perrys Lookdown', 'FD-24', SAT)).toBe(120); // potatoes, two passes averaged
    expect(onDay('The Pinnacles Car Park', 'FD-14', SAT)).toBe(225); // noodles
    expect(onDay('Blue Gum Forest', 'FD-01', SAT)).toBe(338);
    expect(onDay('Perrys Lookdown', 'FD-09', SAT)).toBe(2); // salt, flat, both passes
  });

  it('dates the Hounslow races so the plan splits by day', async () => {
    await seedStarterData();
    const races = alive(await db.races.toArray()).filter((race) => race.name === 'Marathon' || race.name === '17k' || race.name === 'Kids');
    expect(races.find((race) => race.name === 'Marathon')?.day).toBe('2026-09-12');
    expect(races.find((race) => race.name === '17k')?.day).toBe('2026-09-13');
    expect(races.find((race) => race.name === 'Kids')?.day).toBe('2026-09-12');
  });

  it('corrects a seeded race day on a race nobody has touched, and leaves an edited one', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const races = alive(await db.races.toArray());
    const kids = races.find((race) => race.name === 'Kids')!;
    const marathon = races.find((race) => race.name === 'Marathon')!;
    // As an earlier build seeded it, untouched: wrong day, still revision 1.
    await db.races.put({ ...kids, day: '2026-09-13', rev: 1 });
    // As the crew set it, deliberately: a different day at a later revision.
    await db.races.put({ ...marathon, day: '2026-09-13', rev: 4 });

    await ensureSeeded();

    expect((await db.races.get(kids.id))?.day).toBe('2026-09-12');
    expect((await db.races.get(marathon.id))?.day).toBe('2026-09-13');
  });

  it('retires an untouched rule from the old one-per-station seed, but keeps an edited one', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const hounslow = alive(await db.events.toArray()).find((event) => event.name.startsWith('Hounslow'))!;
    const perrys = alive(await db.destinations.toArray()).find((entry) => entry.name === 'Perrys Lookdown')!;
    const water = alive(await db.items.toArray()).find((item) => item.sku === 'FD-01')!;
    const tongs = alive(await db.items.toArray()).find((item) => item.sku === 'FD-02')!;
    // Two rules as the earlier build seeded them: one untouched, one the crew edited.
    const legacy = (sku: string, itemId: string, rev: number) => ({
      id: `stw-cline-hc26-perrys-lookdown-${sku.toLowerCase()}`,
      createdAt: '', updatedAt: '', deletedAt: null, rev, deviceId: 't', syncedAt: null,
      eventId: hounslow.id, destinationId: perrys.id, itemId, perRunner: 2.5, flatQty: 0, note: '', sort: 10,
    });
    await db.consumptionLines.put(legacy('FD-01', water.id, 1));
    await db.consumptionLines.put(legacy('FD-02', tongs.id, 3));

    await ensureSeeded();

    expect((await db.consumptionLines.get('stw-cline-hc26-perrys-lookdown-fd-01'))?.deletedAt).not.toBeNull();
    expect((await db.consumptionLines.get('stw-cline-hc26-perrys-lookdown-fd-02'))?.deletedAt).toBeNull();
  });

  it('lands the food on the food plan, not pre-packed onto the lists', async () => {
    await seedStarterData();

    const lines = alive(await db.consumptionLines.toArray());
    expect(lines).toHaveLength(HOUNSLOW_CONSUMPTION.length);
    // Blue Gum has a food plan but no run-sheet packlist — the walk-in station
    // gets its list when quantities are sent from the food plan.
    const packlists = alive(await db.packlists.toArray());
    expect(packlists.some((entry) => entry.name === 'Blue Gum Forest')).toBe(false);
  });
});

describe('the aid station food list', () => {
  it('lands in its own category with every item from the consumption sheet', async () => {
    await seedStarterData();

    const categories = alive(await db.categories.toArray());
    const food = categories.find((category) => category.name === FOOD_CATEGORY.name);
    expect(food).toBeDefined();

    const items = alive(await db.items.toArray()).filter(
      (item) => item.categoryId === food!.id,
    );
    expect(items).toHaveLength(FOOD_CATALOGUE.length);
    for (const name of ['Water', 'Gels', 'Coke', 'Bananas', 'Noodles (GF)', 'Donuts']) {
      expect(items.some((item) => item.name === name)).toBe(true);
    }
    // All of it gets eaten; none of it comes back on the truck.
    expect(items.every((item) => item.consumable)).toBe(true);
  });

  it('keeps the sheet’s measures as units and pack sizes', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const chips = items.find((item) => item.name === 'Chips (SV + Plain)')!;
    expect(chips.unit).toBe('pack');
    expect(chips.packSize).toBe(6);
    const tea = items.find((item) => item.name === 'Tea (English Breakfast)')!;
    expect(tea.unit).toBe('box');
    expect(tea.packSize).toBe(100);
    const water = items.find((item) => item.sku === 'FD-01')!;
    expect(water.unit).toBe('litre');
  });

  it('sets the low-stock level from the sheet’s event totals, with nothing on hand', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const water = items.find((item) => item.sku === 'FD-01')!;
    const coke = items.find((item) => item.name === 'Coke')!;
    expect(water.minQty).toBe(1815);
    expect(coke.minQty).toBe(501);
    // The sheet's stock column was a snapshot of one race week, not a count;
    // like everything else seeded, on-hand starts at zero until a stocktake.
    expect(water.qtyOnHand).toBe(0);
  });

  it('never reuses a code the generated catalogue owns', () => {
    const equipment = new Set(CATALOGUE.flatMap((group) => group.items.map((item) => item.sku)));
    expect(FOOD_CATALOGUE.every((item) => !equipment.has(item.sku))).toBe(true);
    expect(new Set(FOOD_CATALOGUE.map((item) => item.sku)).size).toBe(FOOD_CATALOGUE.length);
  });

  it('reaches a device that seeded before food existed', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    // Strip the food back out, as a device seeded by an earlier build would be.
    const categories = alive(await db.categories.toArray());
    const food = categories.find((category) => category.name === FOOD_CATEGORY.name)!;
    await db.items.where('categoryId').equals(food.id).delete();
    await db.categories.delete(food.id);

    await ensureSeeded();

    const items = alive(await db.items.toArray());
    expect(items.some((item) => item.sku === 'FD-01')).toBe(true);
    expect(
      alive(await db.categories.toArray()).some(
        (category) => category.name === FOOD_CATEGORY.name,
      ),
    ).toBe(true);
  });
});

describe('per-destination templates', () => {
  it('every SKU it names exists in the catalogue', () => {
    // Checked against the generated catalogue directly, so a rename in the
    // spreadsheet fails here rather than quietly dropping a line from a
    // packing list somebody is relying on at an aid station.
    const known = new Set(CATALOGUE.flatMap((group) => group.items.map((item) => item.sku)));
    const missing = STATION_TEMPLATES.flatMap((spec) =>
      spec.lines.map(([sku]) => sku).filter((sku) => !known.has(sku)),
    );
    expect(missing).toEqual([]);
  });

  it('covers a station, a remote station, a village and a water drop', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    const byType = STATION_TEMPLATES.map((spec) => spec.appliesTo);
    expect(byType).toEqual(['aid_station', 'aid_station', 'event_village', 'water_drop']);
    for (const spec of STATION_TEMPLATES) {
      const stored = templates.find((template) => template.name === spec.name);
      expect(stored?.appliesTo).toBe(spec.appliesTo);
    }
  });

  it('sits alongside the event templates rather than replacing them', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    expect(templates).toHaveLength(EVENT_LISTS.length + STATION_TEMPLATES.length);
  });

  it('keeps the safety kit mandatory', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    const lines = alive(await db.templateLines.toArray());
    const items = alive(await db.items.toArray());
    const remote = templates.find((template) => template.name.startsWith('Remote station'))!;

    const mandatory = lines
      .filter((line) => line.templateId === remote.id && line.mandatory)
      .map((line) => items.find((item) => item.id === line.itemId)?.name);

    // Nobody is driving back out for a forgotten first aid kit.
    expect(mandatory).toContain('First Aid Kit');
    expect(mandatory).toContain('Snake Bite PIB Kit');
    expect(mandatory).toContain('Starlink');
    expect(mandatory).toContain('PLBs');
  });

  it('carries the per-site quantities, not the whole-event totals', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    const lines = alive(await db.templateLines.toArray());
    const items = alive(await db.items.toArray());
    const standard = templates.find((t) => t.name.startsWith('Standard aid station'))!;
    const water = items.find((item) => item.sku === 'WAT-01')!;

    const line = lines.find((entry) => entry.templateId === standard.id && entry.itemId === water.id);
    // One station's worth. GPT100's event total for the same item is 98.
    expect(line?.qty).toBe(4);
    expect(line?.mandatory).toBe(true);
  });

  it('gives every station template lines that point at real items', async () => {
    await seedStarterData();

    const ids = new Set(alive(await db.items.toArray()).map((item) => item.id));
    const templates = alive(await db.templates.toArray());
    const lines = alive(await db.templateLines.toArray());

    for (const spec of STATION_TEMPLATES) {
      const stored = templates.find((template) => template.name === spec.name)!;
      const own = lines.filter((line) => line.templateId === stored.id);
      expect(own).toHaveLength(spec.lines.length);
      expect(own.every((line) => ids.has(line.itemId))).toBe(true);
    }
  });
});

describe('telling per-site templates from whole-event ones', () => {
  it('marks each kind', async () => {
    await seedStarterData();

    const templates = alive(await db.templates.toArray());
    const site = templates.filter((template) => template.scope === 'site');
    const event = templates.filter((template) => template.scope === 'event');
    expect(site).toHaveLength(STATION_TEMPLATES.length);
    expect(event).toHaveLength(EVENT_LISTS.length);
    expect(site.every((template) => !template.name.includes('full event'))).toBe(true);
  });

  it('leaves the choice open — both kinds are still offered', async () => {
    await seedStarterData();

    // The scope steers the default; it does not hide anything from the picker.
    const village = alive(await db.templates.toArray()).filter(
      (template) => template.appliesTo === 'event_village',
    );
    expect(village.length).toBeGreaterThan(1);
    expect(village.some((template) => template.scope === 'site')).toBe(true);
    expect(village.some((template) => template.scope === 'event')).toBe(true);
  });
});

describe('choosing a template for a destination', () => {
  /** Mirrors the picker in EventDetailScreen. */
  const pick = (templates: Template[], type: DestinationType, access: AccessType) => {
    const ofType = templates.filter((template) => template.appliesTo === type);
    const perSite = ofType.filter((template) => template.scope !== 'event');
    return (
      perSite.find((template) => template.suitsAccess?.includes(access)) ??
      perSite.find((template) => !template.suitsAccess) ??
      perSite[0] ??
      ofType[0]
    );
  };

  it('sends a drive-in station and a quad drop to different lists', async () => {
    await seedStarterData();
    const templates = alive(await db.templates.toArray());

    expect(pick(templates, 'aid_station', '2wd')?.name).toMatch(/^Standard aid station/);
    for (const access of ['4wd', 'atv', 'foot', 'helicopter'] as AccessType[]) {
      expect(pick(templates, 'aid_station', access)?.name).toMatch(/^Remote station/);
    }
  });

  it('never starts a single destination from a whole-event total', async () => {
    await seedStarterData();
    const templates = alive(await db.templates.toArray());

    // The village is where the event templates are filed, so this is the case
    // that would go wrong: a 90-line season total as the starting point for one
    // marquee. Order among them is not guaranteed, so the scope has to decide.
    const village = pick(templates, 'event_village', '2wd');
    expect(village?.name).toBe('Event village core');
    expect(village?.scope).toBe('site');
  });

  it('falls back rather than leaving a destination with nothing', async () => {
    await seedStarterData();
    const templates = alive(await db.templates.toArray());

    // No per-site template exists for a start line; the picker should still
    // offer something rather than silently building an empty list.
    expect(pick(templates, 'water_drop', 'helicopter')?.name).toBe('Water-only drop');
    expect(pick([], 'aid_station', '2wd')).toBeUndefined();
  });
});

describe('topping up a device that has already seeded', () => {
  /** A device seeded by an earlier build, before the station templates existed. */
  async function seededWithoutStationTemplates() {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    for (const spec of STATION_TEMPLATES) {
      const stored = alive(await db.templates.toArray()).find((t) => t.name === spec.name)!;
      await db.templateLines.where('templateId').equals(stored.id).delete();
      await db.templates.delete(stored.id);
    }
  }

  it('delivers templates added after that device first ran', async () => {
    await seededWithoutStationTemplates();
    expect(alive(await db.templates.toArray())).toHaveLength(EVENT_LISTS.length);

    await ensureSeeded();

    // Without this the per-station lists shipped in a release and were
    // invisible to everyone already using the app.
    const templates = alive(await db.templates.toArray());
    expect(templates).toHaveLength(EVENT_LISTS.length + STATION_TEMPLATES.length);
    for (const spec of STATION_TEMPLATES) {
      expect(templates.some((template) => template.name === spec.name)).toBe(true);
    }
  });

  it('brings the lines with them', async () => {
    await seededWithoutStationTemplates();

    await ensureSeeded();

    const templates = alive(await db.templates.toArray());
    const lines = alive(await db.templateLines.toArray());
    for (const spec of STATION_TEMPLATES) {
      const stored = templates.find((template) => template.name === spec.name)!;
      expect(lines.filter((line) => line.templateId === stored.id)).toHaveLength(spec.lines.length);
    }
  });

  it('does not resurrect what the crew deleted', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const water = alive(await db.templates.toArray()).find((t) => t.name === 'Water-only drop')!;
    await softDelete(db.templates, water.id);

    await ensureSeeded();

    // A tombstone is a decision, not an absence.
    expect(alive(await db.templates.toArray()).some((t) => t.name === 'Water-only drop')).toBe(false);
  });

  it('leaves edits alone', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const tables = alive(await db.items.toArray()).find((item) => item.sku === 'FRN-01')!;
    await update(db.items, tables.id, { qtyOnHand: 140, bin: 'Rack C', minQty: 200 });

    await ensureSeeded();

    const after = (await db.items.get(tables.id))!;
    expect(after.qtyOnHand).toBe(140);
    expect(after.bin).toBe('Rack C');
    expect(after.minQty).toBe(200);
  });

  it('queues nothing when there is nothing new, so boots do not churn sync', async () => {
    await seedStarterData();
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    const now = new Date().toISOString();
    for (const name of ['items', 'templates', 'templateLines', 'categories'] as const) {
      const rows = (await db[name].toArray()) as SyncMeta[];
      await (db[name] as unknown as { bulkPut(r: SyncMeta[]): Promise<unknown> }).bulkPut(
        rows.map((row) => ({ ...row, syncedAt: now })),
      );
    }

    await ensureSeeded();
    await ensureSeeded();

    const unsent = ((await db.items.toArray()) as SyncMeta[]).filter((row) => row.syncedAt === null);
    expect(unsent).toHaveLength(0);
  });

  it('gives the real catalogue to a device that only ever had the demo', async () => {
    // Chad's phones: seeded long ago with the worked example, so seeded is set
    // and the warehouse list has never arrived.
    const settings = await getSettings();
    await update(db.settings, settings.id, { seeded: true });
    await db.items.put({
      id: 'demo-item-HYD-CUBE20', createdAt: '', updatedAt: '', deletedAt: null, rev: 1,
      deviceId: 't', syncedAt: null, name: 'Water cube 20L', sku: 'HYD-CUBE20', categoryId: null,
      unit: 'each', packSize: 1, bin: 'A1', qtyOnHand: 24, minQty: 18, barcode: null, notes: '',
      consumable: false, archived: false,
    });

    await ensureSeeded();

    const items = alive(await db.items.toArray());
    expect(items.some((item) => item.sku === 'FRN-01')).toBe(true);
    // And the demo row is untouched — removing it is a separate, deliberate act.
    expect(items.some((item) => item.sku === 'HYD-CUBE20')).toBe(true);
  });
});
