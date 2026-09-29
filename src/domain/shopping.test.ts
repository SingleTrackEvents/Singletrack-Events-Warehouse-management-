import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create, sortBySort } from '../db/repo';
import { MockBackend, resetMockServer } from '../sync/mock';
import { applyRemote, collectOutbox, resetCursor, runSync } from '../sync/engine';
import { CREW_ONLY_TABLES, EVENT_TABLES, can, readableTable, writableTables } from '../sync/permissions';
import type { Session } from '../sync/types';
import type { FoodTotal } from './consumption';
import {
  addLowStock,
  addShoppingLine,
  addShortfalls,
  awaitingBooking,
  bookAllBought,
  bookIntoStock,
  bought,
  clearBought,
  describeLine,
  groupByShop,
  inputForItem,
  markBought,
  matchItems,
  restockQty,
  shoppingCsv,
  shoppingText,
  shopsUsed,
  toBuy,
} from './shopping';
import type { Item } from '../db/types';

async function makeItem(name: string, overrides: Partial<Item> = {}): Promise<Item> {
  return create(db.items, {
    name, sku: name.toUpperCase().replace(/\s+/g, '-'), categoryId: null, unit: 'each', packSize: 1,
    bin: 'A1', qtyOnHand: 0, minQty: 0, barcode: null, notes: '', consumable: true, archived: false,
    ...overrides,
  });
}

const lines = async () => sortBySort(alive(await db.shoppingLines.toArray()));

describe('adding to the list', () => {
  it('writes a line for a catalogue item with its name and unit', async () => {
    const coke = await makeItem('Coke cans', { unit: 'carton' });
    const { line, merged } = await addShoppingLine(inputForItem(coke, 3, { shop: ' Costco  Epping ' }));
    expect(merged).toBe(false);
    expect(line).toMatchObject({ itemId: coke.id, name: 'Coke cans', unit: 'carton', qty: 3, shop: 'Costco Epping' });
    expect(line.boughtAt).toBeNull();
    expect(line.source).toBe('hand');
  });

  it('accepts a free-text line for something the catalogue does not hold', async () => {
    const { line } = await addShoppingLine({ name: 'Gas bottle refill', qty: 1 });
    expect(line.itemId).toBeNull();
    expect(line.unit).toBe('each');
  });

  it('refuses a blank name', async () => {
    await expect(addShoppingLine({ name: '   ', qty: 1 })).rejects.toThrow(/name/);
  });

  it('tops up an open line for the same item on the same event', async () => {
    const ice = await makeItem('Ice');
    await addShoppingLine(inputForItem(ice, 2, { eventId: 'ev-1' }));
    const second = await addShoppingLine(inputForItem(ice, 3, { eventId: 'ev-1' }));
    expect(second.merged).toBe(true);
    expect(second.line.qty).toBe(5);
    expect(await lines()).toHaveLength(1);
  });

  it('keeps the same item apart across events, and apart from the warehouse', async () => {
    const ice = await makeItem('Ice');
    await addShoppingLine(inputForItem(ice, 2, { eventId: 'ev-1' }));
    await addShoppingLine(inputForItem(ice, 2, { eventId: 'ev-2' }));
    await addShoppingLine(inputForItem(ice, 2));
    expect(await lines()).toHaveLength(3);
  });

  it('merges a free-text line by name, whatever the case', async () => {
    await addShoppingLine({ name: 'Gas bottle', qty: 1 });
    const again = await addShoppingLine({ name: 'gas BOTTLE ', qty: 1 });
    expect(again.merged).toBe(true);
    expect(again.line.qty).toBe(2);
  });

  it('never merges into a line already bought', async () => {
    const ice = await makeItem('Ice');
    const first = await addShoppingLine(inputForItem(ice, 2));
    await markBought(first.line.id, 'Jess');
    const second = await addShoppingLine(inputForItem(ice, 2));
    expect(second.merged).toBe(false);
    expect(await lines()).toHaveLength(2);
  });

  it('sets rather than adds when told to, and reports an unchanged figure', async () => {
    const ice = await makeItem('Ice');
    await addShoppingLine(inputForItem(ice, 4), 'set');
    const same = await addShoppingLine(inputForItem(ice, 4), 'set');
    expect(same).toMatchObject({ merged: true, changed: false });
    const lower = await addShoppingLine(inputForItem(ice, 1), 'set');
    expect(lower).toMatchObject({ merged: true, changed: true });
    expect(lower.line.qty).toBe(1);
  });
});

describe('fed from the food plan', () => {
  const total = (item: Item, toOrder: number): FoodTotal => ({
    item, total: toOrder + item.qtyOnHand, byDay: [[null, toOrder]], onHand: item.qtyOnHand, toOrder,
  });

  it('lists only the items with something to order, tagged with the event', async () => {
    const coke = await makeItem('Coke cans', { unit: 'carton' });
    const water = await makeItem('Water', { qtyOnHand: 40 });
    const result = await addShortfalls('ev-1', [total(coke, 12), total(water, 0)], 'Jess');
    expect(result).toEqual({ added: 1, updated: 0, unchanged: 0 });
    const [line] = await lines();
    expect(line).toMatchObject({ itemId: coke.id, qty: 12, eventId: 'ev-1', source: 'food_plan', addedBy: 'Jess' });
  });

  it('is safe to run again: today\'s figure replaces yesterday\'s', async () => {
    const coke = await makeItem('Coke cans');
    await addShortfalls('ev-1', [total(coke, 12)]);
    const again = await addShortfalls('ev-1', [total(coke, 12)]);
    expect(again).toEqual({ added: 0, updated: 0, unchanged: 1 });
    const moved = await addShortfalls('ev-1', [total(coke, 20)]);
    expect(moved).toEqual({ added: 0, updated: 1, unchanged: 0 });
    expect((await lines())[0].qty).toBe(20);
  });
});

describe('fed from low stock', () => {
  it('buys enough to get back to the reorder point, and never nothing', async () => {
    const low = await makeItem('Gels', { qtyOnHand: 3, minQty: 10 });
    const atPoint = await makeItem('Cups', { qtyOnHand: 10, minQty: 10 });
    expect(restockQty(low)).toBe(7);
    expect(restockQty(atPoint)).toBe(1);
    const result = await addLowStock([low, atPoint], 'Sam');
    expect(result.added).toBe(2);
    const all = await lines();
    expect(all.every((line) => line.eventId === null && line.source === 'low_stock')).toBe(true);
  });
});

describe('in the shop', () => {
  it('ticks a line off with who and when, and unticks it again', async () => {
    const { line } = await addShoppingLine({ name: 'Ice', qty: 2 });
    const done = await markBought(line.id, 'Jess');
    expect(done?.boughtAt).not.toBeNull();
    expect(done?.boughtBy).toBe('Jess');
    expect(toBuy(await lines())).toHaveLength(0);
    expect(bought(await lines())).toHaveLength(1);

    const undone = await markBought(line.id, 'Jess', false);
    expect(undone?.boughtAt).toBeNull();
    expect(toBuy(await lines())).toHaveLength(1);
  });

  it('groups by shop, alphabetically, with anywhere last', async () => {
    await addShoppingLine({ name: 'Zip ties', qty: 1, shop: 'Bunnings' });
    await addShoppingLine({ name: 'Ice', qty: 2 });
    await addShoppingLine({ name: 'Coke', qty: 12, shop: 'costco' });
    await addShoppingLine({ name: 'Tape', qty: 1, shop: 'Bunnings' });
    const groups = groupByShop(await lines());
    expect(groups.map(([shop, group]) => [shop, group.map((line) => line.name)])).toEqual([
      ['Bunnings', ['Zip ties', 'Tape']],
      ['costco', ['Coke']],
      ['', ['Ice']],
    ]);
    expect(shopsUsed(await lines())).toEqual(['Bunnings', 'costco']);
  });
});

describe('booking a purchase into stock', () => {
  it('writes a receipt to the ledger and raises the shelf count, once', async () => {
    const coke = await makeItem('Coke cans', { qtyOnHand: 2, unit: 'carton' });
    const { line } = await addShoppingLine(inputForItem(coke, 5, { shop: 'Costco' }));

    // Not bought yet: nothing to book.
    expect(await bookIntoStock(line.id, 'Jess')).toBeUndefined();

    await markBought(line.id, 'Jess');
    expect(awaitingBooking(await lines())).toHaveLength(1);
    const movement = await bookIntoStock(line.id, 'Jess');
    expect(movement).toMatchObject({ itemId: coke.id, qty: 5, reason: 'receipt', refType: 'shopping', refId: line.id, by: 'Jess' });
    expect(movement?.note).toBe('Bought at Costco');
    expect((await db.items.get(coke.id))?.qtyOnHand).toBe(7);

    // A second tap must not put it on the shelf twice.
    expect(await bookIntoStock(line.id, 'Jess')).toBeUndefined();
    expect((await db.items.get(coke.id))?.qtyOnHand).toBe(7);
    expect(await db.movements.count()).toBe(1);
    expect(awaitingBooking(await lines())).toHaveLength(0);
  });

  it('has nothing to book for a free-text line', async () => {
    const { line } = await addShoppingLine({ name: 'Birthday cake', qty: 1 });
    await markBought(line.id);
    expect(await bookIntoStock(line.id)).toBeUndefined();
    expect(awaitingBooking(await lines())).toHaveLength(0);
  });

  it('keeps a booked line bought, because the ledger has already moved', async () => {
    const coke = await makeItem('Coke cans');
    const { line } = await addShoppingLine(inputForItem(coke, 5));
    await markBought(line.id);
    await bookIntoStock(line.id);
    const unticked = await markBought(line.id, '', false);
    expect(unticked?.boughtAt).not.toBeNull();
  });

  it('books every waiting line in one go, then clears the bought ones', async () => {
    const coke = await makeItem('Coke cans');
    const cups = await makeItem('Cups');
    const a = await addShoppingLine(inputForItem(coke, 5));
    const b = await addShoppingLine(inputForItem(cups, 50));
    const c = await addShoppingLine({ name: 'Ice', qty: 2 });
    await markBought(a.line.id);
    await markBought(b.line.id);
    await markBought(c.line.id);
    expect(await bookAllBought(await lines(), 'Jess')).toBe(2);
    expect((await db.items.get(coke.id))?.qtyOnHand).toBe(5);
    expect((await db.items.get(cups.id))?.qtyOnHand).toBe(50);
    expect(await clearBought(await lines())).toBe(3);
    expect(await lines()).toHaveLength(0);
    // Clearing the list leaves the stock where the purchase put it.
    expect((await db.items.get(coke.id))?.qtyOnHand).toBe(5);
  });
});

describe('finding the item behind what was typed', () => {
  it('matches every word in any order and puts the closest name first', async () => {
    const cans = await makeItem('Coca-Cola cans (24)');
    const zero = await makeItem('Coke Zero cans');
    await makeItem('Coke syrup');
    await makeItem('Archived coke', { archived: true });
    expect(matchItems([cans, zero], 'coke cans').map((item) => item.name)).toEqual(['Coke Zero cans']);
    const all = alive(await db.items.toArray());
    expect(matchItems(all, 'coke').map((item) => item.name)).toEqual(['Coke syrup', 'Coke Zero cans']);
    expect(matchItems(all, 'cola').map((item) => item.name)).toEqual(['Coca-Cola cans (24)']);
    expect(matchItems(all, 'cans').some((item) => item.name === 'Archived coke')).toBe(false);
    expect(matchItems(all, '')).toEqual([]);
  });

  it('finds by code as well as name', async () => {
    const item = await makeItem('Electrolyte sachets', { sku: 'AS-ELEC' });
    expect(matchItems([item], 'as-elec')).toHaveLength(1);
  });
});

describe('the list as text', () => {
  it('reads one shop at a time, ticked where bought', async () => {
    const coke = await makeItem('Coke cans', { unit: 'carton' });
    const a = await addShoppingLine(inputForItem(coke, 12, { shop: 'Costco', eventId: 'ev-1' }));
    await addShoppingLine({ name: 'Zip ties', qty: 2, unit: 'pack', shop: 'Bunnings', note: 'long ones' });
    await addShoppingLine({ name: 'Ice', qty: 3, unit: 'bag' });
    await markBought(a.line.id);
    const text = shoppingText(await lines(), (id) => (id === 'ev-1' ? 'Hounslow Classic' : undefined));
    expect(text).toBe(
      [
        'Shopping list',
        '',
        'Bunnings',
        '☐ 2 pks Zip ties - long ones',
        '',
        'Costco',
        '☑ 12 ctns Coke cans (Hounslow Classic)',
        '',
        'Anywhere',
        '☐ 3 bags Ice',
      ].join('\n'),
    );
    expect(shoppingText([], () => undefined)).toContain('Nothing to buy');
  });

  it('describes a line for its row', async () => {
    const { line } = await addShoppingLine({ name: 'Ice', qty: 3, unit: 'bag', eventId: 'ev-1', source: 'packlist', note: 'for the eskies' });
    expect(describeLine(line, 'Hounslow Classic')).toBe('3 bags · Hounslow Classic · short while packing · for the eskies');
    const plain = await addShoppingLine({ name: 'Tape', qty: 1 });
    expect(describeLine(plain.line)).toBe('1 · Warehouse');
  });

  it('exports a spreadsheet with a row per line', async () => {
    const coke = await makeItem('Coke cans', { sku: 'COKE' });
    const a = await addShoppingLine(inputForItem(coke, 12, { shop: 'Costco', eventId: 'ev-1', source: 'food_plan' }));
    await addShoppingLine({ name: 'Ice', qty: 3, unit: 'bag' });
    await markBought(a.line.id);
    const rows = shoppingCsv(await lines(), () => 'Hounslow', (id) => (id === coke.id ? 'COKE' : ''));
    expect(rows[0][0]).toBe('Item');
    expect(rows[1]).toEqual(['Coke cans', 'COKE', '12', 'each', 'Costco', 'Hounslow', 'from the food plan', '', 'yes', 'no']);
    expect(rows[2]).toEqual(['Ice', '', '3', 'bag', '', 'Warehouse', 'added by hand', '', 'no', '']);
  });
});

/* ---------------------------------------------------------- who sees it -- */

const backend = new MockBackend();

const session = (role: Session['role'], eventId: string | null = null): Session => ({
  userId: `u-${role}`, displayName: role, email: `${role}@example.com`, role,
  scope: { eventId, destinationId: null }, token: `t-${role}`, expiresAt: null, guest: false,
});

describe('who keeps the shopping list', () => {
  beforeEach(async () => {
    await resetMockServer();
    resetCursor();
  });

  it('is the admin and the crew, and nobody else', () => {
    expect(can(session('admin'), 'shopping:manage')).toBe(true);
    expect(can(session('crew'), 'shopping:manage')).toBe(true);
    // Crew given one event buy for that event.
    expect(can(session('crew', 'ev-1'), 'shopping:manage', { eventId: 'ev-1' })).toBe(true);
    expect(can(session('crew', 'ev-1'), 'shopping:manage', { eventId: 'ev-2' })).toBe(false);
    expect(can(session('driver'), 'shopping:manage')).toBe(false);
    expect(can(session('volunteer'), 'shopping:manage')).toBe(false);
  });

  it('keeps the table from drivers and volunteers on every path', () => {
    expect(CREW_ONLY_TABLES).toContain('shoppingLines');
    expect(readableTable('admin', 'shoppingLines')).toBe(true);
    expect(readableTable('crew', 'shoppingLines')).toBe(true);
    expect(readableTable('driver', 'shoppingLines')).toBe(false);
    expect(readableTable('volunteer', 'shoppingLines')).toBe(false);
    expect(writableTables(session('driver'))).not.toContain('shoppingLines');
    expect(writableTables(session('volunteer'))).not.toContain('shoppingLines');
    expect(writableTables(session('crew'))).toContain('shoppingLines');
    // Lines for one event travel with that event's crew.
    expect(EVENT_TABLES).toContain('shoppingLines');
    expect(writableTables(session('crew', 'ev-1'))).toContain('shoppingLines');
  });

  it('never reaches a driver through the stand-in server', async () => {
    const admin = await backend.completeEmailSignIn('email:admin@singletrack.test');
    await addShoppingLine({ name: 'Ice', qty: 2 });
    expect((await runSync(backend, admin)).pushed).toBe(1);

    const driver = session('driver');
    await db.shoppingLines.clear();
    resetCursor();
    const pulled = await backend.pull(driver, null);
    expect(pulled.changes.shoppingLines).toBeUndefined();
    expect((await applyRemote(pulled.changes)).applied).toBe(0);

    // Crew see it.
    const crew = session('crew');
    const forCrew = await backend.pull(crew, null);
    expect(forCrew.changes.shoppingLines).toHaveLength(1);

    // A line a driver somehow wrote never leaves the phone, and is refused if sent.
    await addShoppingLine({ name: 'Tape', qty: 1 });
    expect(Object.keys(await collectOutbox(driver))).not.toContain('shoppingLines');
    const refused = await backend.push(driver, { shoppingLines: await db.shoppingLines.toArray() });
    expect(refused.refused).toBe(1);
  });

  it('lets crew given one event write that event\'s lines and not the warehouse restock', async () => {
    const crew = session('crew', 'ev-1');
    const mine = await addShoppingLine({ name: 'Ice', qty: 2, eventId: 'ev-1' });
    const theirs = await addShoppingLine({ name: 'Ice', qty: 2, eventId: 'ev-2' });
    const restock = await addShoppingLine({ name: 'Ice', qty: 2 });
    const result = await backend.push(crew, { shoppingLines: [mine.line, theirs.line, restock.line] });
    expect(result.accepted).toBe(1);
    expect(result.refused).toBe(2);
  });
});
