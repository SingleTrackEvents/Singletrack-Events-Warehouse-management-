import { describe, expect, it } from 'vitest';
import { db, getSettings } from './db';
import { alive, softDelete, update } from './repo';
import { ensureSeeded, seedStarterData } from './seed';
import { CATALOGUE, EVENT_LISTS } from './catalogue';
import { STATION_TEMPLATES } from './stationTemplates';
import type { AccessType, DestinationType, SyncMeta, Template } from './types';

describe('the starting catalogue', () => {
  it('loads the real warehouse list', async () => {
    await seedStarterData();

    const items = alive(await db.items.toArray());
    const expected = CATALOGUE.reduce((sum, group) => sum + group.items.length, 0);
    expect(await db.categories.count()).toBe(CATALOGUE.length);
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

  it('creates no events — those are the crew’s to enter', async () => {
    await seedStarterData();

    expect(await db.events.count()).toBe(0);
    expect(await db.destinations.count()).toBe(0);
    expect(await db.packlists.count()).toBe(0);
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
