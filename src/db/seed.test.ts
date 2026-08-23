import { describe, expect, it } from 'vitest';
import { db, getSettings } from './db';
import { alive } from './repo';
import { ensureSeeded, seedStarterData } from './seed';
import { CATALOGUE, EVENT_LISTS } from './catalogue';

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
    expect(templates).toHaveLength(EVENT_LISTS.length);
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
    expect(alive(await db.templates.toArray())).toHaveLength(EVENT_LISTS.length);
  });

  it('only seeds once, however many times the app boots', async () => {
    await ensureSeeded();
    const first = await db.items.count();

    await ensureSeeded();
    await ensureSeeded();

    expect(await db.items.count()).toBe(first);
    expect((await getSettings()).seeded).toBe(true);
  });

  it('does not seed over the top of a database that already has stock', async () => {
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

    expect(await db.items.count()).toBe(1);
  });
});
