import type { Category, Item } from '../db/types';

/**
 * Suggesting a SKU for a new item.
 *
 * The catalogue's codes are `PREFIX-NN` — STR-01, WAT-06, FD-14 — one prefix
 * per category, numbered in the order things were added. Left to type it by
 * hand somebody has to go and look up what the last one was, so the number
 * gets guessed, and two items end up sharing a code that a label and a scan
 * both rely on being unique.
 *
 * So the prefix is read off the items already filed in the category rather
 * than invented: whatever the catalogue actually uses there wins, however it
 * came to be. Only an empty category falls back to building one from its name.
 */

const SKU_PATTERN = /^([A-Z][A-Z0-9]{0,5})-(\d{1,4})$/;

/** Split a catalogue SKU into its prefix and number, or null if it is free-form. */
export function parseSku(sku: string): { prefix: string; number: number } | null {
  const match = sku.trim().toUpperCase().match(SKU_PATTERN);
  return match ? { prefix: match[1], number: Number(match[2]) } : null;
}

/**
 * A prefix from a category name, for a category holding nothing yet.
 *
 * Three letters off the leading word, which is how the catalogue's own codes
 * read — "Water & Ice" gives WAT, "Structure & Shelter" STR, "Registration,
 * Merch & Timing" REG, each matching the code that category already uses. A
 * word too short to fill three letters borrows initials from the words after
 * it, so "Cold Chain & Drop Bags" does not come out as a two-letter code.
 */
export function prefixFromName(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word) && !MINOR.has(word.toLowerCase()));
  if (!words.length) return 'ITM';
  let prefix = words[0].slice(0, 3).toUpperCase();
  for (let index = 1; prefix.length < 3 && index < words.length; index += 1) {
    prefix += words[index][0].toUpperCase();
  }
  return prefix;
}

/** Words that carry no meaning in a code. */
const MINOR = new Set(['and', 'or', 'the', 'of', 'a']);

/**
 * The prefix this category's items already use.
 *
 * The commonest one wins rather than the first: a category with fifteen WAT
 * codes and one stray hand-typed MISC should keep suggesting WAT.
 */
export function prefixForCategory(categoryId: string | null, items: Item[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.deletedAt || (item.categoryId ?? null) !== categoryId) continue;
    const parsed = parseSku(item.sku);
    if (parsed) counts.set(parsed.prefix, (counts.get(parsed.prefix) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The next free SKU for a category, e.g. "WAT-10".
 *
 * The number is one past the highest already used on that prefix — anywhere in
 * the catalogue, not just in this category, since a code has to be unique
 * across the warehouse for a scan to mean one thing. Gaps left by deleted items
 * are not reused: the tombstone still holds the code, and reissuing it would
 * point an old label at a new item.
 *
 * Returns an empty string when there is no category to go on, which leaves the
 * field blank rather than suggesting something arbitrary.
 */
export function suggestSku(
  categoryId: string | null,
  categories: Category[],
  items: Item[],
): string {
  const category = categories.find((entry) => entry.id === categoryId);
  const prefix =
    prefixForCategory(categoryId, items) ?? (category ? prefixFromName(category.name) : null);
  if (!prefix) return '';

  // Tombstoned items count: their codes are still printed on labels out there.
  let highest = 0;
  for (const item of items) {
    const parsed = parseSku(item.sku);
    if (parsed?.prefix === prefix && parsed.number > highest) highest = parsed.number;
  }
  return `${prefix}-${String(highest + 1).padStart(2, '0')}`;
}
