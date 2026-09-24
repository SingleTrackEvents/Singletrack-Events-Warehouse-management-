import { RESERVED_HEADING, isQuantityHeading, similarity } from './importMatch';

/**
 * Reading a pack list out of a grid of cells.
 *
 * Whatever the file was — a worksheet, a CSV, a page of a PDF — it arrives
 * here as rows of text, and this works out what it is a list *of*. Three
 * shapes cover every pack list the crew has produced so far:
 *
 *   matrix    items down the side, stations across the top, quantities in
 *             the cells — the consolidated inventory sheet and most run sheets
 *   sections  one block per station: a heading naming the place, then item
 *             and quantity rows beneath it, as a PDF run sheet is laid out
 *   list      just items and quantities, with the place decided on import
 *
 * Nothing here touches the database or decides what an item *is*; it says
 * "the file wants 4 of 'Trestle table' at 'Perrys'" and leaves matching that
 * to the catalogue for the next step, which can show its guesses for checking.
 */

/** One sheet, page or file as rows of cell text. Ragged rows are fine. */
export interface Grid {
  /** Where it came from, for the review screen: "Aid Stations", "page 2". */
  name: string;
  rows: string[][];
}

export interface ParsedLine {
  /** The item exactly as the file writes it, quantity prefix stripped. */
  name: string;
  qty: number;
  /**
   * The column heading or section heading this quantity sits under, or null
   * when the file names no place at all.
   */
  place: string | null;
  /** Anything the file said alongside the number. */
  note: string;
  /** The category-looking heading above this line, if the file has them. */
  section: string | null;
  /** Sheet or page and row, for pointing at the source in the review. */
  where: string;
}

export type Layout = 'matrix' | 'sections' | 'list' | 'empty';

export interface ParsedGrid {
  source: string;
  layout: Layout;
  /** Distinct place headings in the order the file introduces them. */
  places: string[];
  lines: ParsedLine[];
  /** Rows that were passed over: no quantity, or a number with no name. */
  skipped: number;
  /** The last place heading seen, to carry onto the next page of a PDF. */
  lastPlace: string | null;
}

export interface InterpretHints {
  /** Destination names of the event, so a section heading can be recognised. */
  placeNames?: string[];
  /** Category names, so a category row is not mistaken for an item. */
  categoryNames?: string[];
  /** The place a previous page ended on, when this grid continues it. */
  carryPlace?: string | null;
}

/* ------------------------------------------------------------- quantities -- */

const TICK = /^\s*(✓|✔|☑|x|y|yes|true|tick|req|required)\s*$/i;
const NONE = /^\s*(-|–|—|n\/?a|no|none|nil|0|false|✗)\s*$/i;
const BARE_NUMBER = /^\s*[x×]?\s*\d+(?:[.,]\d+)?\s*[x×]?\s*$/i;

/**
 * The number a cell means, or null when it is not a quantity.
 *
 * Pack lists are typed by people: "4", "x4", "4 x", "2 boxes", "4 (1 spare)"
 * and a bare tick all turn up in the same column. A tick is one, a dash or
 * "n/a" is nothing, and prose with no number in it is not a quantity at all —
 * which is what tells an item row from a heading row.
 */
export function parseQty(cell: string): number | null {
  const text = cell.trim();
  if (!text) return null;
  if (NONE.test(text)) return 0;
  if (TICK.test(text)) return 1;
  const match = text.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  // A cell that is mostly words with a number buried in it ("Marquee 3x3
  // white", "Water cube 20L blue") is a name, not a count; a quantity has
  // little else in it. A dimension ("3x3") is not a count either, though
  // "2 x" and "x 2" are.
  const letters = text.replace(/[^a-z]/gi, '').length;
  if (letters > 12) return null;
  if (/\d\s*[x×]\s*\d/i.test(text)) return null;
  // "1,200" is a thousand-and-something; "1,5" is one and a half.
  const numeric = match[0].replace(/,(\d{3})$/, '$1').replace(',', '.');
  const value = Number(numeric);
  return Number.isFinite(value) ? value : null;
}

/** True for a cell that is nothing but a count or a tick — never a heading. */
function isBareQty(cell: string): boolean {
  const text = cell.trim();
  return Boolean(text) && (BARE_NUMBER.test(text) || TICK.test(text) || NONE.test(text));
}

/** Anything left in a quantity cell besides the number, for the line's note. */
function qtyRemark(cell: string): string {
  const text = cell.trim();
  if (parseQty(text) === null || TICK.test(text) || NONE.test(text)) return '';
  return text
    .replace(/\d+(?:[.,]\d+)?/, '')
    .replace(/^\s*[x×]\s*|\s*[x×]\s*$/gi, '')
    .replace(/^[\s()[\]-]+|[\s()[\]-]+$/g, '')
    .trim();
}

/**
 * "2 x Trestle table", "Trestle table x2", "Trestle table (2)", "Trestle
 * table - 4" — a count written into the name, split back out. A number that
 * is part of the name ("Marquee 3x3", "Water cube 20L") stays where it is.
 */
export function splitInlineQty(name: string): { name: string; qty: number | null } {
  const text = name.trim();
  const named = (candidate: string) => /[a-z]{2,}/i.test(candidate);

  const leading = text.match(/^(\d+(?:\.\d+)?)\s*(?:[x×]|pcs?|-|–)?\s+(.+)$/i);
  if (leading && named(leading[2])) return { name: leading[2].trim(), qty: Number(leading[1]) };

  const times = text.match(/^(.+?)\s+[x×]\s*(\d+(?:\.\d+)?)\s*(?:pcs?|ea|each)?\s*$/i);
  if (times && named(times[1])) return { name: times[1].trim(), qty: Number(times[2]) };

  const labelled = text.match(/^(.+?)\s*[-–:([]?\s*(?:qty|quantity)\s*:?\s*(\d+(?:\.\d+)?)\s*[)\]]?\s*$/i);
  if (labelled && named(labelled[1])) return { name: labelled[1].trim(), qty: Number(labelled[2]) };

  const dashed = text.match(/^(.+?)\s+[-–:]\s*(\d+(?:\.\d+)?)\s*(?:pcs?|ea|each)?\s*$/);
  if (dashed && named(dashed[1])) return { name: dashed[1].trim(), qty: Number(dashed[2]) };

  const bracketed = text.match(/^(.+?)\s*[([]\s*(\d+(?:\.\d+)?)\s*[)\]]\s*$/);
  if (bracketed && named(bracketed[1])) return { name: bracketed[1].trim(), qty: Number(bracketed[2]) };

  return { name: text, qty: null };
}

/* --------------------------------------------------------------- headings -- */

const cell = (rows: string[][], row: number, col: number): string => (rows[row]?.[col] ?? '').trim();

/** Could this cell be a heading? Anything with words in it. */
function isHeadingText(value: string): boolean {
  return Boolean(value.trim()) && !isBareQty(value);
}

function isNumeric(value: string): boolean {
  return Boolean(value.trim()) && parseQty(value) !== null;
}

/** Rows that sum the column: never gear, whatever numbers sit beside them. */
const TOTAL_ROW = /^\s*(total|totals|sub\s*total|grand\s*total|sum|count)\s*:?\s*$/i;

/** Does this heading name a place, as far as the file itself can tell? */
function looksLikePlace(text: string, placeNames: string[]): boolean {
  return placeNames.some((name) => similarity(text, name) >= 0.55);
}

function looksLikeCategory(text: string, categoryNames: string[]): boolean {
  const cleaned = text.replace(/^\d+[.)]?\s*/, '');
  return categoryNames.some((name) => similarity(cleaned, name) >= 0.7);
}

/** ALL CAPS, or ending in a colon: written to stand over the rows below it. */
function looksLikeHeading(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return /:\s*$/.test(text) || (letters.length >= 4 && letters === letters.toUpperCase());
}

interface Columns {
  header: number;
  item: number;
  /** Columns headed by a place name, with their headings. */
  places: Array<{ col: number; heading: string }>;
  /** Columns headed "Qty" or the like, or unheaded but numeric. */
  qty: number[];
  note: number | null;
  category: number | null;
  /** A column naming the place per row, for a flat list with a station column. */
  place: number | null;
}

const NOTE_HEADING = /^\s*(notes?|comments?|remarks?|details?)\s*$/i;
const CATEGORY_HEADING = /^\s*(category|cat|section|group|type|area)\s*$/i;
const PLACE_HEADING = /^\s*(destination|station|aid\s*station|location|where|site|place|to|for|stop)\s*$/i;
const ITEM_HEADING = /^\s*(item|items|description|equipment|gear|name|product|kit)\s*$/i;

/**
 * Which columns hold what.
 *
 * The header is the row that best explains the numbers beneath it: for each
 * candidate row near the top, a column counts as a quantity column when its
 * heading has words in it and what follows is numbers and blanks rather than
 * words. The row with the most such columns wins. A file with no such row
 * is a plain list, read from the top.
 */
function findColumns(rows: string[][]): Columns {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const limit = Math.min(rows.length, 25);

  const below = (col: number, from: number) => {
    let numbers = 0;
    let words = 0;
    for (let row = from; row < rows.length; row += 1) {
      const value = cell(rows, row, col);
      if (!value) continue;
      if (isNumeric(value)) numbers += 1;
      else words += 1;
    }
    return { numbers, words };
  };

  const emptyColumns = (): Columns => ({
    header: -1,
    item: -1,
    places: [],
    qty: [],
    note: null,
    category: null,
    place: null,
  });

  let best: { row: number; qtyCols: number[]; score: number } | null = null;
  for (let row = 0; row < limit; row += 1) {
    const qtyCols: number[] = [];
    let score = 0;
    let wordColumns = 0;
    let numbers = 0;
    let quantityHeading = false;
    for (let col = 0; col < width; col += 1) {
      const heading = cell(rows, row, col);
      if (!isHeadingText(heading)) continue;
      const under = below(col, row + 1);
      if (under.numbers >= 1 && under.words <= Math.max(1, under.numbers * 0.25)) {
        qtyCols.push(col);
        numbers += under.numbers;
        quantityHeading ||= isQuantityHeading(heading);
        score += RESERVED_HEADING.test(heading) && !isQuantityHeading(heading) ? 0 : 1;
      } else if (under.words >= 1) wordColumns += 1;
    }
    // A header needs somewhere for the item names to live, and one stray
    // number under a word is not a column of quantities.
    const credible = qtyCols.length > 0 && wordColumns > 0 && (numbers >= 2 || quantityHeading);
    if (credible && (!best || score > best.score)) best = { row, qtyCols, score };
  }

  const columns = emptyColumns();
  if (best) {
    columns.header = best.row;
    for (const col of best.qtyCols) {
      const heading = cell(rows, best.row, col);
      if (isQuantityHeading(heading)) columns.qty.push(col);
      else if (!RESERVED_HEADING.test(heading)) columns.places.push({ col, heading });
    }
    for (let col = 0; col < width; col += 1) {
      if (best.qtyCols.includes(col)) continue;
      const heading = cell(rows, best.row, col);
      if (NOTE_HEADING.test(heading)) columns.note ??= col;
      else if (CATEGORY_HEADING.test(heading)) columns.category ??= col;
      else if (PLACE_HEADING.test(heading)) columns.place ??= col;
      else if (ITEM_HEADING.test(heading) && columns.item < 0) columns.item = col;
    }
  } else {
    // No header: any column that is mostly numbers is a quantity column.
    for (let col = 0; col < width; col += 1) {
      const under = below(col, 0);
      if (under.numbers >= 2 && under.numbers >= under.words * 2) columns.qty.push(col);
    }
  }

  if (columns.item < 0) {
    // The wordiest column that is not spoken for.
    const taken = new Set([...columns.qty, ...columns.places.map((place) => place.col)]);
    for (const col of [columns.note, columns.category, columns.place]) if (col !== null) taken.add(col);
    let most = 0;
    for (let col = 0; col < width; col += 1) {
      if (taken.has(col)) continue;
      const { words } = below(col, columns.header + 1);
      if (words > most) {
        most = words;
        columns.item = col;
      }
    }
  }
  return columns;
}

/* ------------------------------------------------------------- interpret -- */

/** Read one grid into lines. Pure; see the module note for the shapes it reads. */
export function interpretGrid(grid: Grid, hints: InterpretHints = {}): ParsedGrid {
  const rows = grid.rows.map((row) => row.map((value) => (value ?? '').toString()));
  const placeNames = hints.placeNames ?? [];
  const categoryNames = hints.categoryNames ?? [];
  const result: ParsedGrid = {
    source: grid.name,
    layout: 'empty',
    places: [],
    lines: [],
    skipped: 0,
    lastPlace: hints.carryPlace ?? null,
  };
  if (!rows.some((row) => row.some((value) => value.trim()))) return result;

  const columns = findColumns(rows);
  if (columns.item < 0) return result;

  const matrix = columns.places.length > 0;
  result.layout = matrix ? 'matrix' : 'list';
  const seenPlaces = new Set<string>();
  const notePlace = (place: string | null) => {
    if (place && !seenPlaces.has(place)) {
      seenPlaces.add(place);
      result.places.push(place);
    }
  };
  if (matrix) for (const place of columns.places) notePlace(place.heading);

  let currentPlace: string | null = hints.carryPlace ?? null;
  let section: string | null = null;

  /** A words-only row: a place, a category, a repeated header, or nothing. */
  const readHeading = (text: string): 'place' | 'section' | 'ignored' => {
    if (RESERVED_HEADING.test(text) || TOTAL_ROW.test(text)) return 'ignored';
    if (!matrix && looksLikePlace(text, placeNames)) {
      currentPlace = text;
      notePlace(text);
      result.layout = 'sections';
      return 'place';
    }
    if (looksLikeCategory(text, categoryNames) || looksLikeHeading(text)) {
      section = text;
      return 'section';
    }
    return 'ignored';
  };

  for (let row = 0; row < rows.length; row += 1) {
    if (row === columns.header) continue;
    const raw = cell(rows, row, columns.item);
    const where = `${grid.name} row ${row + 1}`;
    const qtyCells = matrix
      ? columns.places.map((place) => cell(rows, row, place.col))
      : columns.qty.map((col) => cell(rows, row, col));
    const hasNumbers = qtyCells.some(isNumeric);
    const texts = rows[row].map((value) => value.trim()).filter(Boolean);

    if (row < columns.header) {
      // Above the header only titles and headings live: a station name over
      // its table, a category over its block. Never gear.
      if (texts.length === 1 && isHeadingText(texts[0])) readHeading(texts[0]);
      continue;
    }

    if (!raw) {
      if (hasNumbers) {
        // A number with no name beside it is a total or a stray.
        result.skipped += 1;
      } else if (columns.category !== null && cell(rows, row, columns.category)) {
        // "Cooking" in the category column with nothing else on the row.
        section = cell(rows, row, columns.category);
      } else if (texts.length === 1 && isHeadingText(texts[0])) {
        readHeading(texts[0]);
      }
      continue;
    }

    if (TOTAL_ROW.test(raw)) continue;

    if (!hasNumbers) {
      // A words-only row is a heading of some kind, or a list entry with no
      // count. Which, depends on whether the file has a place for numbers.
      if (readHeading(raw) !== 'ignored' || RESERVED_HEADING.test(raw)) continue;
      if (matrix || columns.qty.length) {
        result.skipped += 1;
        continue;
      }
    }

    const inline = splitInlineQty(raw);
    const name = inline.name;
    if (!name) continue;
    const noteCell = columns.note !== null ? cell(rows, row, columns.note) : '';
    if (columns.category !== null) {
      const categoryCell = cell(rows, row, columns.category);
      if (categoryCell) section = categoryCell;
    }

    if (matrix) {
      columns.places.forEach((place, index) => {
        const value = qtyCells[index];
        const qty = parseQty(value);
        if (qty === null || qty <= 0) return;
        result.lines.push({
          name,
          qty,
          place: place.heading,
          note: [noteCell, qtyRemark(value)].filter(Boolean).join(' · '),
          section,
          where,
        });
      });
      continue;
    }

    const valueCell = qtyCells.find(isNumeric) ?? '';
    const qty = valueCell ? parseQty(valueCell) : (inline.qty ?? 1);
    if (qty === null || qty <= 0) {
      result.skipped += 1;
      continue;
    }
    let place = currentPlace;
    if (columns.place !== null) {
      const placeCell = cell(rows, row, columns.place);
      if (placeCell) place = placeCell;
    }
    if (place) {
      // Noted as first used rather than first seen, so a heading carried
      // over from the previous page still comes before this page's own.
      notePlace(place);
      result.layout = 'sections';
    }
    result.lines.push({
      name,
      qty,
      place,
      note: [noteCell, qtyRemark(valueCell)].filter(Boolean).join(' · '),
      section,
      where,
    });
  }

  result.lastPlace = matrix ? null : currentPlace;
  return result;
}

/**
 * Read a run of grids — the worksheets of a workbook, the pages of a PDF —
 * carrying a section heading from one page onto the next, since a PDF breaks
 * a station's table wherever the page ends.
 */
export function interpretGrids(grids: Grid[], hints: InterpretHints = {}): ParsedGrid[] {
  const parsed: ParsedGrid[] = [];
  let carry: string | null = hints.carryPlace ?? null;
  for (const grid of grids) {
    const result = interpretGrid(grid, { ...hints, carryPlace: carry });
    parsed.push(result);
    carry = result.lastPlace;
  }
  return parsed;
}
