import { db, nowIso } from '../db/db';
import { alive, create, nextSort, softDelete, update } from '../db/repo';
import type { Item, Movement, ShoppingLine, ShoppingSource, Unit } from '../db/types';
import type { FoodTotal } from './consumption';
import { formatQty } from './format';
import { recordMovements, round2, shortfall } from './stock';

/**
 * The shopping list.
 *
 * One list for the warehouse, because the supplier run usually covers two
 * events and a restock in one trip. Each line says what to buy, how many,
 * where, and which event it is for. Lines arrive from three places besides
 * being typed in: the food plan's shortfalls, stock below its reorder point,
 * and packlist lines the crew could not fill. Where a line names a catalogue
 * item, ticking it off in the shop and booking it in at home writes the
 * receipt to the stock ledger, so the low-stock alarm clears on its own.
 */

export const SHOPPING_SOURCE_LABELS: Record<ShoppingSource, string> = {
  hand: 'added by hand',
  food_plan: 'from the food plan',
  low_stock: 'below reorder point',
  packlist: 'short while packing',
};

/** What a new line needs. Anything not given takes a sensible blank. */
export interface ShoppingInput {
  itemId?: string | null;
  name: string;
  qty: number;
  unit?: Unit;
  shop?: string;
  note?: string;
  eventId?: string | null;
  source?: ShoppingSource;
  refId?: string | null;
  by?: string;
}

/**
 * How a new quantity meets a line already on the list for the same thing.
 *
 * `add` tops it up: two people each remembering a bag of ice want two bags.
 * `set` replaces it: the food plan's shortfall is a derived figure, and
 * re-running the plan after a projection moves should land today's number,
 * not today's plus yesterday's.
 */
export type MergeMode = 'add' | 'set';

export interface AddResult {
  line: ShoppingLine;
  /** True when an existing open line was updated rather than a new one written. */
  merged: boolean;
  /** False when a merge changed nothing, so a toast can say so honestly. */
  changed: boolean;
}

/** A shop name as it should be stored: trimmed, one space between words. */
export function cleanShop(shop: string): string {
  return shop.replace(/\s+/g, ' ').trim();
}

export function isBought(line: ShoppingLine): boolean {
  return Boolean(line.boughtAt);
}

export function isBooked(line: ShoppingLine): boolean {
  return Boolean(line.bookedAt);
}

/** Lines still to buy, in list order. */
export function toBuy(lines: ShoppingLine[]): ShoppingLine[] {
  return lines.filter((line) => !line.deletedAt && !line.boughtAt);
}

/** Lines already bought, most recent first. */
export function bought(lines: ShoppingLine[]): ShoppingLine[] {
  return lines
    .filter((line) => !line.deletedAt && line.boughtAt)
    .sort((a, b) => (b.boughtAt ?? '').localeCompare(a.boughtAt ?? ''));
}

/** Bought lines that name a catalogue item and have not reached the ledger yet. */
export function awaitingBooking(lines: ShoppingLine[]): ShoppingLine[] {
  return lines.filter(
    (line) => !line.deletedAt && line.boughtAt && !line.bookedAt && line.itemId && line.qty > 0,
  );
}

/**
 * The open line this input would merge into, if there is one.
 *
 * Same item on the same event, or for a free-text line the same name in any
 * case. A bought line is never merged into: buying coke on Tuesday does not
 * mean Thursday's coke is bought.
 */
function findOpenMatch(lines: ShoppingLine[], input: ShoppingInput): ShoppingLine | undefined {
  const eventId = input.eventId ?? null;
  const name = input.name.trim().toLowerCase();
  return toBuy(lines).find((line) => {
    if ((line.eventId ?? null) !== eventId) return false;
    if (input.itemId) return line.itemId === input.itemId;
    return !line.itemId && line.name.trim().toLowerCase() === name;
  });
}

/** Add a line, merging into an open line for the same thing on the same event. */
export async function addShoppingLine(input: ShoppingInput, mode: MergeMode = 'add'): Promise<AddResult> {
  const name = input.name.trim();
  if (!name) throw new Error('A shopping line needs a name.');
  const qty = round2(Math.max(0, input.qty));
  const lines = alive(await db.shoppingLines.toArray());
  const match = findOpenMatch(lines, input);

  if (match) {
    const next = mode === 'set' ? qty : round2(match.qty + qty);
    if (next === match.qty) return { line: match, merged: true, changed: false };
    const updated = await update(db.shoppingLines, match.id, { qty: next });
    return { line: updated ?? match, merged: true, changed: true };
  }

  const line = await create(db.shoppingLines, {
    itemId: input.itemId ?? null,
    name,
    qty,
    unit: input.unit ?? 'each',
    shop: cleanShop(input.shop ?? ''),
    note: (input.note ?? '').trim(),
    eventId: input.eventId ?? null,
    source: input.source ?? 'hand',
    refId: input.refId ?? null,
    addedBy: input.by ?? '',
    boughtAt: null,
    boughtBy: '',
    bookedAt: null,
    sort: nextSort(lines),
  });
  return { line, merged: false, changed: true };
}

/** The input for a catalogue item, so callers do not repeat the field mapping. */
export function inputForItem(
  item: Item,
  qty: number,
  extra: Omit<ShoppingInput, 'itemId' | 'name' | 'qty' | 'unit'> = {},
): ShoppingInput {
  return { itemId: item.id, name: item.name, qty, unit: item.unit, ...extra };
}

export interface FeedResult {
  added: number;
  updated: number;
  unchanged: number;
}

async function feed(inputs: ShoppingInput[], mode: MergeMode): Promise<FeedResult> {
  const result: FeedResult = { added: 0, updated: 0, unchanged: 0 };
  for (const input of inputs) {
    const outcome = await addShoppingLine(input, mode);
    if (!outcome.merged) result.added += 1;
    else if (outcome.changed) result.updated += 1;
    else result.unchanged += 1;
  }
  return result;
}

/**
 * Put the food plan's shortfalls on the list for an event.
 *
 * Only the items with something to order; a line already there for the same
 * item is set to today's figure rather than topped up, so this is safe to tap
 * again whenever the projections change. Nothing the crew typed by hand is
 * touched unless it names the same item for the same event, in which case
 * the plan's number wins, the same way it does on a packlist.
 */
export async function addShortfalls(eventId: string, totals: FoodTotal[], by = ''): Promise<FeedResult> {
  const inputs = totals
    .filter((total) => total.toOrder > 0)
    .map((total) => inputForItem(total.item, total.toOrder, { eventId, source: 'food_plan', by }));
  return feed(inputs, 'set');
}

/**
 * How much of a low item to buy: enough to get back above the reorder
 * point, and never nothing, since the item is on the list because it is low.
 */
export function restockQty(item: Item): number {
  return Math.max(1, shortfall(item));
}

/** Put items that have fallen below their reorder point on the warehouse list. */
export async function addLowStock(items: Item[], by = ''): Promise<FeedResult> {
  const inputs = items.map((item) =>
    inputForItem(item, restockQty(item), { eventId: null, source: 'low_stock', by }),
  );
  return feed(inputs, 'set');
}

/**
 * Tick a line off, or untick it.
 *
 * A line already booked into stock stays bought: the ledger has moved, and
 * unticking it would leave the shelf count claiming stock the list says was
 * never bought. The caller is told nothing changed.
 */
export async function markBought(lineId: string, by = '', isNowBought = true): Promise<ShoppingLine | undefined> {
  const line = await db.shoppingLines.get(lineId);
  if (!line || line.deletedAt) return undefined;
  if (line.bookedAt) return line;
  if (isNowBought === Boolean(line.boughtAt)) return line;
  return update(db.shoppingLines, lineId, {
    boughtAt: isNowBought ? nowIso() : null,
    boughtBy: isNowBought ? by : '',
  });
}

/**
 * Write a bought line to the stock ledger as a receipt.
 *
 * Once, and only for a catalogue item: a free-text line has nothing to book,
 * and a line booked twice would put the purchase on the shelf twice. The
 * ledger row points back at the line so the movement history can say where
 * the stock came from.
 */
export async function bookIntoStock(lineId: string, by = ''): Promise<Movement | undefined> {
  return db.transaction('rw', db.items, db.movements, db.shoppingLines, async () => {
    const line = await db.shoppingLines.get(lineId);
    if (!line || line.deletedAt || !line.boughtAt || line.bookedAt || !line.itemId || line.qty <= 0) {
      return undefined;
    }
    const [movement] = await recordMovements([
      {
        itemId: line.itemId,
        qty: line.qty,
        reason: 'receipt',
        refType: 'shopping',
        refId: line.id,
        note: line.shop ? `Bought at ${line.shop}` : 'Shopping run',
        by,
      },
    ]);
    // No ledger row means the item has gone from the catalogue; the line is
    // left unbooked so the gap is visible rather than quietly closed.
    if (!movement) return undefined;
    await update(db.shoppingLines, line.id, { bookedAt: nowIso() });
    return movement;
  });
}

/** Book every bought catalogue line that is still waiting. Returns how many landed. */
export async function bookAllBought(lines: ShoppingLine[], by = ''): Promise<number> {
  let booked = 0;
  for (const line of awaitingBooking(lines)) {
    if (await bookIntoStock(line.id, by)) booked += 1;
  }
  return booked;
}

/** Take the bought lines off the list. Stock already booked in stays booked. */
export async function clearBought(lines: ShoppingLine[]): Promise<number> {
  const done = bought(lines);
  for (const line of done) await softDelete(db.shoppingLines, line.id);
  return done.length;
}

/**
 * Lines grouped by shop, shops in alphabetical order with "anywhere" last.
 *
 * The list is read standing in one shop at a time, so everything for Costco
 * wants to be together whatever order it was added in. Within a shop, list
 * order is kept.
 */
export function groupByShop(lines: ShoppingLine[]): Array<[shop: string, lines: ShoppingLine[]]> {
  const buckets = new Map<string, ShoppingLine[]>();
  for (const line of lines) {
    const key = cleanShop(line.shop);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(line);
    else buckets.set(key, [line]);
  }
  return [...buckets.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

/** Shops the list has used, most used first, for suggesting on a new line. */
export function shopsUsed(lines: ShoppingLine[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.deletedAt) continue;
    const shop = cleanShop(line.shop);
    if (shop) counts.set(shop, (counts.get(shop) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .map(([shop]) => shop);
}

/**
 * Find catalogue items for something typed on a new line.
 *
 * Every term must appear in the name or the code, so "coke can" finds
 * "Coca-Cola cans (24)" whatever order the words are typed. Names that start
 * with what was typed come first, because that is usually the one meant.
 */
export function matchItems(items: Item[], query: string, limit = 6): Item[] {
  const text = query.trim().toLowerCase();
  const terms = text.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const rank = (item: Item) => {
    const name = item.name.toLowerCase();
    if (name === text) return 0;
    if (name.startsWith(text)) return 1;
    if (name.includes(text)) return 2;
    return 3;
  };
  return items
    .filter((item) => !item.archived && !item.deletedAt)
    .filter((item) => {
      const haystack = `${item.name} ${item.sku}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The second line of a row: quantity, who it is for, and why it is here. */
export function describeLine(line: ShoppingLine, eventName?: string): string {
  const parts = [formatQty(line.qty, line.unit)];
  parts.push(line.eventId ? (eventName ?? 'One event') : 'Warehouse');
  if (line.source !== 'hand') parts.push(SHOPPING_SOURCE_LABELS[line.source]);
  if (line.note) parts.push(line.note);
  return parts.join(' · ');
}

/**
 * The list as plain text, for the share sheet or a message to whoever is at
 * the shop. One heading per shop, one line per thing, ticked where bought.
 */
export function shoppingText(
  lines: ShoppingLine[],
  eventName: (eventId: string | null) => string | undefined,
): string {
  const open = lines.filter((line) => !line.deletedAt);
  if (!open.length) return 'Shopping list\nNothing to buy.';
  const out: string[] = ['Shopping list'];
  for (const [shop, group] of groupByShop(open)) {
    out.push('', shop || 'Anywhere');
    for (const line of group) {
      const bits = [formatQty(line.qty, line.unit), line.name];
      if (line.eventId) bits.push(`(${eventName(line.eventId) ?? 'event'})`);
      if (line.note) bits.push(`- ${line.note}`);
      out.push(`${line.boughtAt ? '☑' : '☐'} ${bits.join(' ')}`);
    }
  }
  return out.join('\n');
}

/** The list as a spreadsheet, for a supplier order or the accounts. */
export function shoppingCsv(
  lines: ShoppingLine[],
  eventName: (eventId: string | null) => string | undefined,
  itemSku: (itemId: string | null) => string,
): string[][] {
  const rows: string[][] = [['Item', 'SKU', 'Qty', 'Unit', 'Shop', 'For', 'Why', 'Note', 'Bought', 'Booked in']];
  for (const line of lines) {
    if (line.deletedAt) continue;
    rows.push([
      line.name,
      itemSku(line.itemId),
      String(line.qty),
      line.unit,
      line.shop,
      line.eventId ? (eventName(line.eventId) ?? '') : 'Warehouse',
      SHOPPING_SOURCE_LABELS[line.source],
      line.note,
      line.boughtAt ? 'yes' : 'no',
      line.bookedAt ? 'yes' : line.itemId ? 'no' : '',
    ]);
  }
  return rows;
}
