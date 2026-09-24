import type { Category, Destination, Item } from '../db/types';

/**
 * Matching names off somebody's spreadsheet to what the warehouse calls things.
 *
 * A run sheet says "Trestle table", the catalogue says "Trestle Tables"; the
 * sheet says "Electric kettle", the catalogue says "Kettle - Electric". Nobody
 * wants to fix sixty of those by hand, so names are compared loosely: case,
 * punctuation, plurals and word order are ignored, and a score says how close
 * the rest is. Anything short of certain is shown as a guess to be checked
 * rather than written quietly, because a wrong guess sends the wrong gear.
 */

/** Words that carry no meaning when telling two names apart. */
const STOP = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'x', 'for', 'with', 'per', 'to', 'in', 'at', 'each', 'ea',
  'equivalent', 'misc', 'various', 'assorted',
]);

/** Spellings that mean the same thing on a packing list. */
const SYNONYMS: Record<string, string> = {
  tbl: 'table',
  tbls: 'table',
  tbles: 'table',
  ctn: 'carton',
  ctns: 'carton',
  pk: 'pack',
  pks: 'pack',
  pkt: 'pack',
  pkts: 'pack',
  bx: 'box',
  ext: 'extension',
  gen: 'generator',
  genny: 'generator',
  gennie: 'generator',
  lge: 'large',
  lrg: 'large',
  sml: 'small',
  med: 'medium',
  kgs: 'kg',
  ltr: 'litre',
  ltrs: 'litre',
  liter: 'litre',
  liters: 'litre',
  litres: 'litre',
  gazebo: 'marquee',
  gazebos: 'marquee',
  cooler: 'esky',
  coolers: 'esky',
  eskies: 'esky',
  sanitizer: 'sanitiser',
  bbq: 'barbecue',
  hivis: 'hi-vis',
};

/** A single word reduced to its comparable form. */
function stem(word: string): string {
  const mapped = SYNONYMS[word] ?? word;
  if (mapped.length <= 3) return mapped;
  // Plurals: "tables" → "table", "boxes" → "box", "batteries" → "battery".
  if (mapped.endsWith('ies') && mapped.length > 4) return `${mapped.slice(0, -3)}y`;
  if (/(ses|xes|shes|ches)$/.test(mapped)) return mapped.slice(0, -2);
  if (mapped.endsWith('s') && !mapped.endsWith('ss')) return mapped.slice(0, -1);
  return mapped;
}

/**
 * The words of a name that matter, each reduced to a comparable form.
 * "Marquee Walls - 3x3 (or equivalent)" → ["marquee", "wall", "3x3"].
 */
export function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !STOP.has(word))
    .map(stem)
    .filter(Boolean);
}

/** A name flattened to one comparable string; equal keys are the same thing. */
export function nameKey(name: string): string {
  return tokens(name).sort().join(' ');
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const padded = ` ${text} `;
  for (let index = 0; index < padded.length - 1; index += 1) {
    const gram = padded.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient over two multisets, 0–1. */
function dice(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  let total = 0;
  for (const [gram, count] of a) {
    total += count;
    shared += Math.min(count, b.get(gram) ?? 0);
  }
  for (const count of b.values()) total += count;
  return total ? (2 * shared) / total : 0;
}

function counted(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/**
 * How alike two names are, 0–1.
 *
 * Whole words count most, so "Trestle table" and "Trestle Tables" score as the
 * same thing and word order does not matter. Letter pairs pull a near-miss
 * spelling ("sanitizer") back up towards its match, and a name that is
 * entirely contained in the other ("Kettle" in "Kettle - Electric") is scored
 * generously rather than penalised for the words it lacks.
 */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const wordScore = dice(counted(ta), counted(tb));
  const letterScore = dice(bigrams(ta.join(' ')), bigrams(tb.join(' ')));
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const contained = shorter.every((word) => longer.includes(word));
  const containment = contained ? shorter.length / longer.length : 0;
  return Math.max(wordScore * 0.7 + letterScore * 0.3, containment * 0.85 + 0.1 * letterScore);
}

/** How sure the matcher is; anything below `sure` is shown for checking. */
export type Confidence = 'sure' | 'likely' | 'none';

export interface ItemMatch {
  item: Item;
  score: number;
  confidence: Confidence;
}

const SURE = 0.92;
const LIKELY = 0.6;

function confidenceFor(score: number): Confidence {
  if (score >= SURE) return 'sure';
  if (score >= LIKELY) return 'likely';
  return 'none';
}

/**
 * The catalogue item a name most likely means, or null when nothing comes close.
 *
 * An exact SKU or an exact normalised name is certain. Otherwise the best
 * similarity wins, and archived items are never offered: a retired thing
 * turning back up on a packlist is exactly what archiving was meant to stop.
 */
export function matchItem(name: string, items: Item[]): ItemMatch | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const live = items.filter((item) => !item.deletedAt && !item.archived);
  const upper = trimmed.toUpperCase();
  const bySku = live.find((item) => item.sku && item.sku.toUpperCase() === upper);
  if (bySku) return { item: bySku, score: 1, confidence: 'sure' };

  const key = nameKey(trimmed);
  if (key) {
    const exact = live.find((item) => nameKey(item.name) === key);
    if (exact) return { item: exact, score: 1, confidence: 'sure' };
  }

  let best: ItemMatch | null = null;
  for (const item of live) {
    const score = similarity(trimmed, item.name);
    if (!best || score > best.score) best = { item, score, confidence: confidenceFor(score) };
  }
  return best && best.confidence !== 'none' ? best : null;
}

export interface DestinationMatch {
  destination: Destination;
  score: number;
}

/** Words a column heading uses that add nothing to which station it is. */
const STATION_NOISE = /\b(aid|station|stn|checkpoint|cp|drop|point)\b/g;

/**
 * A heading with its initialisms written out where the name explains them:
 * "GC carpark" against "Grand Canyon Carpark" becomes "grand canyon carpark".
 * Only a run of two or more initials counts, and only in the name's own
 * word order, so a stray "at" does not turn into "Allview Trail".
 */
function expandInitials(heading: string, name: string): string {
  const words = tokens(name);
  const initials = words.map((word) => word[0]).join('');
  return tokens(heading)
    .map((word) => {
      if (word.length < 2 || word.length > words.length || words.includes(word)) return word;
      const at = initials.indexOf(word);
      return at < 0 ? word : words.slice(at, at + word.length).join(' ');
    })
    .join(' ');
}

/** Every number in a heading, so "AS3" and "Aid Station 3" find "Aid 3". */
function numbersIn(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/**
 * The event destination a heading refers to.
 *
 * Headings are short and abbreviated ("AS3", "GC Carpark", "Village"), so the
 * bar is lower than for items and shared numbers count for a lot: a sheet
 * column headed "Aid 3" is the destination whose name carries a 3, whatever
 * else it is called. A heading that is plainly a spreadsheet word ("Total",
 * "Qty") matches nothing. Type words help where they can — "Finish" finds the
 * one finish line — but only when the event has a single destination of that
 * type, since two aid stations cannot be told apart by the word "aid".
 */
export function matchDestination(
  heading: string,
  destinations: Destination[],
): DestinationMatch | null {
  const trimmed = heading.trim();
  if (!trimmed || RESERVED_HEADING.test(trimmed)) return null;
  const live = destinations.filter((destination) => !destination.deletedAt);
  if (!live.length) return null;

  let best: DestinationMatch | null = null;
  for (const destination of live) {
    let score = similarity(trimmed, destination.name);
    const cleaned = trimmed.replace(STATION_NOISE, ' ');
    const cleanedName = destination.name.replace(STATION_NOISE, ' ');
    score = Math.max(score, similarity(cleaned, cleanedName));
    // Initials: "GC" for "Grand Canyon", "GCC" for "Grand Canyon Carpark".
    const expanded = expandInitials(cleaned, destination.name);
    if (expanded !== tokens(cleaned).join(' ')) {
      score = Math.max(score, similarity(expanded, cleanedName), 0.8);
    }
    const numbers = numbersIn(trimmed);
    if (numbers.length && numbers.some((number) => numbersIn(destination.name).includes(number))) {
      score = Math.max(score, 0.75);
    }
    if (!best || score > best.score) best = { destination, score };
  }

  if (best && best.score >= 0.5) return best;

  // Type words, when they can only mean one place.
  const typeHints: Array<[RegExp, Destination['type']]> = [
    [/\b(village|hq|base|expo|hub)\b/i, 'event_village'],
    [/\bfinish\b/i, 'finish'],
    [/\bstart\b/i, 'start'],
    [/\bwater\s*drop\b/i, 'water_drop'],
    [/\bcheckpoint\b/i, 'checkpoint'],
    [/\bstore\b/i, 'store'],
  ];
  for (const [pattern, type] of typeHints) {
    if (!pattern.test(trimmed)) continue;
    const ofType = live.filter((destination) => destination.type === type);
    if (ofType.length === 1) return { destination: ofType[0], score: 0.6 };
  }
  return null;
}

/**
 * Column headings that are spreadsheet furniture rather than places: the item
 * column, totals, notes. Kept in one place so layout detection and destination
 * matching agree on what to leave alone.
 */
export const RESERVED_HEADING =
  /^\s*(item|items|description|equipment|gear|name|product|sku|code|category|cat|qty|quantity|quantities|q|#|no|no\.|num|number|count|total|totals|sum|max|min|hold|stock|on\s*hand|in\s*stock|unit|units|uom|notes?|comments?|remarks?|status|tick|check|✓|packed|done|source|owner|supplier|location|bin|price|cost|\$|weight|kg|size)\s*$/i;

/** True when a heading reads as a quantity column rather than a place. */
export function isQuantityHeading(heading: string): boolean {
  return /^\s*(qty|quantity|quantities|q|#|no|no\.|num|number|count|total|totals|sum|amount|required|req|needed|need)\s*\.?\s*$/i.test(
    heading,
  );
}

/** The category a sheet's section heading names, if it names one. */
export function matchCategory(heading: string, categories: Category[]): Category | null {
  const trimmed = heading.replace(/^\d+[.)]?\s*/, '').trim();
  if (!trimmed) return null;
  let best: { category: Category; score: number } | null = null;
  for (const category of categories) {
    if (category.deletedAt) continue;
    const score = similarity(trimmed, category.name);
    if (!best || score > best.score) best = { category, score };
  }
  // A low bar: this only picks a default the reviewer sees, and "Water" over
  // a block of cubes and jugs means "Water & Ice" often enough to be useful.
  return best && best.score >= 0.5 ? best.category : null;
}
