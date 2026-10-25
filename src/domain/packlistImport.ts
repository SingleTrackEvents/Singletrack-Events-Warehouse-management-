import { db } from '../db/db';
import { create, liveWhere, nextSort, update } from '../db/repo';
import type { Category, Destination, Item, PacklistLine, SyncMeta } from '../db/types';
import { interpretGrids, parseQty } from './importGrid';
import type { Grid, InterpretHints, ParsedGrid } from './importGrid';
import {
  RESERVED_HEADING,
  isQuantityHeading,
  matchCategory,
  matchDestination,
  matchItem,
  nameKey,
  similarity,
  tokens,
} from './importMatch';
import type { Confidence, ItemMatch } from './importMatch';
import { createPacklist, packlistForDestination } from './packlists';
import { suggestSku } from './skus';
import { round2 } from './stock';

/**
 * From a parsed file to packlist lines.
 *
 * Two halves. `buildPlan` reads what the file wants and matches it to the
 * warehouse — which destination each heading is, which catalogue item each
 * name is, and what is new — folding duplicates as it goes, so one item never
 * appears twice on a list however many times the file mentions it. Nothing is
 * written. The review screen shows the plan, the crew correct what the matcher
 * got wrong, and `commitImport` then writes exactly what was shown.
 */

/** What to do with one column or section heading in the file. */
export interface PlacePlan {
  heading: string;
  action: 'existing' | 'create' | 'skip';
  destinationId: string | null;
  /** True when the matcher chose the destination rather than a person. */
  guessed: boolean;
  score: number;
  lines: number;
}

/** One item the file asks for, wherever and however often it names it. */
export interface ItemPlan {
  /** Stable key for the review screen: the catalogue id, or the name's key. */
  key: string;
  /** The name as the file first spells it. */
  name: string;
  /** Other spellings the file used that were folded into this line. */
  alsoWritten: string[];
  action: 'existing' | 'create' | 'skip';
  itemId: string | null;
  confidence: Confidence;
  score: number;
  /** Category for a new item: guessed from the section heading over it. */
  categoryId: string | null;
  section: string | null;
  /** Quantity per place heading; a null heading is a line the file left unplaced. */
  quantities: Array<{ place: string | null; qty: number }>;
  totalQty: number;
  notes: string[];
  where: string[];
  /** A quantity big enough to be a typo: shown for checking, never refused. */
  large: boolean;
}

/** A row of the file that brought nothing in, and why, for the review. */
export interface RowProblem {
  where: string;
  /** The item as the row names it, or the row's first words. */
  name: string;
  /** The cell that could not be used, exactly as written. */
  text: string;
  reason: 'negative' | 'not a number';
}

/**
 * More than this of anything on one station is checked by a person first.
 * A station's cups run to a couple of thousand; a million is a slipped key.
 */
export const LARGE_QTY = 5000;

export interface ImportPlan {
  eventId: string;
  places: PlacePlan[];
  items: ItemPlan[];
  /** Destination for lines the file gave no place, chosen on the review screen. */
  unplacedDestinationId: string | null;
  unplacedLines: number;
  /** Rows passed over while reading, for the summary. */
  skippedRows: number;
  /** Rows that wanted to say something and could not, shown one by one. */
  problems: RowProblem[];
}

export interface PlanContext {
  eventId: string;
  destinations: Destination[];
  items: Item[];
  categories: Category[];
}

function mostCommon(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Match the file to the warehouse and fold its duplicates. Writes nothing. */
export function buildPlan(parsed: ParsedGrid[], context: PlanContext): ImportPlan {
  const live = context.destinations.filter((destination) => !destination.deletedAt);

  // Places: each heading once, matched to a destination, no destination
  // claimed twice. Two headings wanting the same station is a sign one of
  // them is something else, so the weaker guess is left for a person.
  const headings: string[] = [];
  for (const grid of parsed) for (const place of grid.places) if (!headings.includes(place)) headings.push(place);
  const candidates = headings.map((heading) => ({ heading, match: matchDestination(heading, live) }));
  const claimed = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.match) continue;
    const id = candidate.match.destination.id;
    if ((claimed.get(id) ?? -1) < candidate.match.score) claimed.set(id, candidate.match.score);
  }
  const lineCounts = new Map<string, number>();
  for (const grid of parsed) {
    for (const line of grid.lines) {
      if (line.place) lineCounts.set(line.place, (lineCounts.get(line.place) ?? 0) + 1);
    }
  }
  const places: PlacePlan[] = candidates.map(({ heading, match }) => {
    const won = match && claimed.get(match.destination.id) === match.score;
    return {
      heading,
      action: won ? 'existing' : live.length ? 'skip' : 'create',
      destinationId: won ? match.destination.id : null,
      guessed: Boolean(won),
      score: won ? match.score : 0,
      lines: lineCounts.get(heading) ?? 0,
    };
  });

  // Items: match each distinct spelling once, then fold spellings that
  // resolve to the same thing — two rows for one item, or "Trestle table"
  // and "Trestle Tables" — into one plan line with the quantities summed.
  const matches = new Map<string, ReturnType<typeof matchItem>>();
  const byKey = new Map<string, ItemPlan>();
  for (const grid of parsed) {
    for (const line of grid.lines) {
      const spelling = nameKey(line.name);
      if (!spelling) continue;
      if (!matches.has(spelling)) matches.set(spelling, sharpenMatch(line.name, matchItem(line.name, context.items), context.items));
      const match = matches.get(spelling) ?? null;
      const key = match ? `item:${match.item.id}` : `new:${spelling}`;

      let plan = byKey.get(key);
      if (!plan) {
        plan = {
          key,
          name: line.name,
          alsoWritten: [],
          action: match ? 'existing' : 'create',
          itemId: match?.item.id ?? null,
          confidence: match?.confidence ?? 'none',
          score: match?.score ?? 0,
          categoryId: null,
          section: null,
          quantities: [],
          totalQty: 0,
          notes: [],
          where: [],
          large: false,
        };
        byKey.set(key, plan);
      }
      if (line.name !== plan.name && !plan.alsoWritten.includes(line.name)) plan.alsoWritten.push(line.name);
      const slot = plan.quantities.find((entry) => entry.place === line.place);
      if (slot) slot.qty = round2(slot.qty + line.qty);
      else plan.quantities.push({ place: line.place, qty: line.qty });
      plan.totalQty = round2(plan.totalQty + line.qty);
      if (plan.quantities.some((entry) => entry.qty > LARGE_QTY)) plan.large = true;
      if (line.note && !plan.notes.includes(line.note)) plan.notes.push(line.note);
      plan.where.push(line.where);
      if (line.section) plan.section = plan.section ?? line.section;
    }
  }

  const items = [...byKey.values()];
  for (const plan of items) {
    if (plan.action !== 'create') continue;
    const sections = parsed.flatMap((grid) =>
      grid.lines.filter((line) => nameKey(line.name) === plan.key.slice(4) || plan.alsoWritten.includes(line.name)).map((line) => line.section),
    );
    const section = mostCommon(sections) ?? plan.section;
    plan.section = section;
    plan.categoryId = section ? (matchCategory(section, context.categories)?.id ?? null) : null;
  }

  const unplacedLines = items.reduce(
    (sum, plan) => sum + plan.quantities.filter((entry) => entry.place === null).length,
    0,
  );

  return {
    eventId: context.eventId,
    places,
    items,
    unplacedDestinationId: unplacedLines && live.length === 1 ? live[0].id : null,
    unplacedLines,
    skippedRows: parsed.reduce((sum, grid) => sum + grid.skipped, 0),
    problems: [],
  };
}

/**
 * Turn away a guess that drops a word the file used.
 *
 * "Starlink Mini" is not a Starlink: when every word of the catalogue name is
 * in the file's name and the file says more, the extra word is usually what
 * makes it a different thing. A catalogue item carrying every word the file
 * used is offered instead, the plainest such name first; failing that,
 * nothing is guessed and the line comes in as a new item for a person to
 * match. An exact match is never second-guessed.
 */
export function sharpenMatch(name: string, match: ItemMatch | null, items: Item[]): ItemMatch | null {
  if (!match || match.confidence === 'sure') return match;
  const asked = tokens(name);
  const offered = tokens(match.item.name);
  const saysMore = asked.some((word) => !offered.includes(word));
  const coversOffered = offered.every((word) => asked.includes(word));
  if (!saysMore || !coversOffered) return match;
  const fuller = items
    .filter((item) => !item.deletedAt && !item.archived)
    .map((item) => ({ item, words: tokens(item.name) }))
    .filter(({ words }) => asked.every((word) => words.includes(word)))
    .sort((a, b) => a.words.length - b.words.length || a.item.name.localeCompare(b.item.name))[0];
  return fuller ? { item: fuller.item, score: similarity(name, fuller.item.name), confidence: 'likely' } : null;
}

/** A cell that is a number below zero: "-5", "- 2", "−3". */
const NEGATIVE = /^\s*[-−–]\s*\d+(?:[.,]\d+)?\s*$/;

/** The first words on a row, to name it in the review. */
function rowName(row: string[], skip: ReadonlySet<number> = new Set()): string {
  return row.find((value, col) => !skip.has(col) && value.trim() && parseQty(value) === null)?.trim() ?? '';
}

/**
 * Read the files into a plan, with the rows that brought nothing in listed.
 *
 * A negative quantity is taken out before reading, because the reader sees
 * the digits and not the sign, and "-5" would arrive as five. A word where
 * the number goes ("abc") is found afterwards: a row that made no line but
 * has words in a column the rest of the file uses for numbers.
 */
export function planImport(grids: Grid[], hints: InterpretHints, context: PlanContext): ImportPlan {
  const problems: RowProblem[] = [];
  const cleaned = grids.map((grid) => ({
    ...grid,
    rows: grid.rows.map((row, index) =>
      row.map((value) => {
        if (!NEGATIVE.test(value)) return value;
        problems.push({ where: `${grid.name} row ${index + 1}`, name: rowName(row), text: value.trim(), reason: 'negative' });
        return '0';
      }),
    ),
  }));
  const parsed = interpretGrids(cleaned, hints);
  cleaned.forEach((grid, index) => problems.push(...unreadQuantities(grid, parsed[index])));
  const order = (problem: RowProblem) => {
    const match = problem.where.match(/^(.*) row (\d+)$/);
    return { grid: grids.findIndex((grid) => grid.name === match?.[1]), row: Number(match?.[2] ?? 0) };
  };
  problems.sort((a, b) => order(a).grid - order(b).grid || order(a).row - order(b).row);
  return { ...buildPlan(parsed, context), problems };
}

/** Rows whose number column holds words, so they were passed over. */
function unreadQuantities(grid: Grid, parsed: ParsedGrid | undefined): RowProblem[] {
  if (!parsed) return [];
  const prefix = `${grid.name} row `;
  const produced = new Set(
    parsed.lines
      .filter((line) => line.where.startsWith(prefix))
      .map((line) => Number(line.where.slice(prefix.length)) - 1),
  );
  if (!produced.size) return [];
  // The number columns are the ones the rows that did come in mostly have
  // numbers in.
  const width = Math.max(...grid.rows.map((row) => row.length));
  const numberCols = new Set<number>();
  for (let col = 0; col < width; col += 1) {
    let numbers = 0;
    for (const row of produced) if (parseQty(grid.rows[row]?.[col] ?? '') !== null) numbers += 1;
    if (numbers * 2 >= produced.size) numberCols.add(col);
  }
  const headings = new Set(parsed.places.map((place) => place.trim().toLowerCase()));
  const problems: RowProblem[] = [];
  grid.rows.forEach((row, index) => {
    if (produced.has(index)) return;
    const name = rowName(row, numberCols);
    if (!name || RESERVED_HEADING.test(name)) return;
    const words = [...numberCols]
      .map((col) => (row[col] ?? '').trim())
      .filter((value) => value && parseQty(value) === null);
    if (!words.length) return;
    // A header row: the places across the top, or "Qty".
    if (words.some((value) => headings.has(value.toLowerCase()) || isQuantityHeading(value))) return;
    problems.push({ where: `${prefix}${index + 1}`, name, text: words[0], reason: 'not a number' });
  });
  return problems;
}

/* ---------------------------------------------------------------- commit -- */

export interface CommitOptions {
  /**
   * What to do when the packlist already has a line for an item: set its
   * required quantity to the file's number, or add the file's number to it.
   * Setting is the default so importing the same file twice changes nothing.
   */
  existing: 'set' | 'add';
  /** Where the file came from, written into the notes of anything created. */
  source: string;
}

export interface CommitResult {
  destinationsCreated: number;
  itemsCreated: number;
  packlistsCreated: number;
  packlistsTouched: number;
  linesAdded: number;
  linesUpdated: number;
  linesUnchanged: number;
  /** Quantities that had nowhere to go: skipped headings, or unplaced lines with no destination chosen. */
  linesSkipped: number;
}

/** Write the plan. Every decision was on the review screen; this just does it. */
export async function commitImport(plan: ImportPlan, options: CommitOptions): Promise<CommitResult> {
  const result: CommitResult = {
    destinationsCreated: 0,
    itemsCreated: 0,
    packlistsCreated: 0,
    packlistsTouched: 0,
    linesAdded: 0,
    linesUpdated: 0,
    linesUnchanged: 0,
    linesSkipped: 0,
  };
  const sourceNote = options.source ? `Imported from ${options.source}` : 'Imported from a pack list';

  // Destinations first, so every heading resolves to an id.
  const destinationFor = new Map<string, string>();
  const existingDestinations = await liveWhere(db.destinations, 'eventId', plan.eventId);
  let destinationSort = nextSort(existingDestinations);
  for (const place of plan.places) {
    if (place.action === 'existing' && place.destinationId) {
      destinationFor.set(place.heading, place.destinationId);
    } else if (place.action === 'create') {
      const destination = await create(db.destinations, {
        eventId: plan.eventId,
        name: place.heading,
        type: 'aid_station',
        courseKm: null,
        access: '2wd',
        accessNotes: '',
        lat: null,
        lng: null,
        crewLead: '',
        phone: '',
        openTime: '',
        closeTime: '',
        notes: sourceNote,
        sort: destinationSort,
      });
      destinationSort += 10;
      destinationFor.set(place.heading, destination.id);
      result.destinationsCreated += 1;
    }
  }

  // Then items, so every line has something to point at. SKUs are suggested
  // one after another against the growing catalogue so two new items in one
  // category do not both come out as WAT-10.
  const catalogue = await db.items.toArray();
  const categories = await db.categories.toArray();
  const itemFor = new Map<string, string>();
  for (const item of plan.items) {
    if (item.action === 'existing' && item.itemId) itemFor.set(item.key, item.itemId);
    else if (item.action === 'create') {
      const created = await create(db.items, {
        name: item.name.trim(),
        sku: suggestSku(item.categoryId, categories, catalogue),
        categoryId: item.categoryId,
        unit: 'each',
        packSize: 1,
        bin: '',
        qtyOnHand: 0,
        minQty: 0,
        barcode: null,
        notes: sourceNote,
        consumable: false,
        archived: false,
      });
      catalogue.push(created);
      itemFor.set(item.key, created.id);
      result.itemsCreated += 1;
    }
  }

  // Quantities per destination, then per item, folding headings that map to
  // the same destination and lines that map to the same item.
  const wanted = new Map<string, Map<string, { qty: number; notes: string[] }>>();
  for (const item of plan.items) {
    const itemId = itemFor.get(item.key);
    for (const entry of item.quantities) {
      const destinationId = entry.place === null ? plan.unplacedDestinationId : destinationFor.get(entry.place);
      if (!itemId || !destinationId) {
        result.linesSkipped += 1;
        continue;
      }
      const perItem = wanted.get(destinationId) ?? new Map<string, { qty: number; notes: string[] }>();
      const slot = perItem.get(itemId) ?? { qty: 0, notes: [] };
      slot.qty = round2(slot.qty + entry.qty);
      for (const note of item.notes) if (!slot.notes.includes(note)) slot.notes.push(note);
      perItem.set(itemId, slot);
      wanted.set(destinationId, perItem);
    }
  }

  for (const [destinationId, perItem] of wanted) {
    const destination = await db.destinations.get(destinationId);
    if (!destination || destination.deletedAt) {
      result.linesSkipped += perItem.size;
      continue;
    }
    let packlist = await packlistForDestination(destinationId);
    if (!packlist) {
      packlist = await createPacklist(destination);
      result.packlistsCreated += 1;
    }
    const existing = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    const byItem = new Map(existing.map((line) => [line.itemId, line]));
    let sort = nextSort(existing);
    const additions: Array<Omit<PacklistLine, keyof SyncMeta>> = [];

    for (const [itemId, slot] of perItem) {
      const match = byItem.get(itemId);
      if (match) {
        const qty = options.existing === 'add' ? round2(match.qtyRequired + slot.qty) : slot.qty;
        if (qty === match.qtyRequired) {
          result.linesUnchanged += 1;
          continue;
        }
        await update(db.packlistLines, match.id, { qtyRequired: qty });
        result.linesUpdated += 1;
      } else {
        additions.push({
          packlistId: packlist.id,
          itemId,
          qtyRequired: slot.qty,
          qtyPacked: 0,
          qtyReturned: 0,
          mandatory: false,
          containerId: null,
          note: slot.notes.join(' · '),
          sort,
        });
        sort += 10;
      }
    }
    for (const addition of additions) await create(db.packlistLines, addition);
    result.linesAdded += additions.length;
    result.packlistsTouched += 1;
  }

  return result;
}
