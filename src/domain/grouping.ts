import type { Category } from '../db/types';

/**
 * Grouping rows under their stock category.
 *
 * Both the packlist and the warehouse list are read standing in front of the
 * gear, where everything for one corner of the shed — or one corner of the
 * truck — wants to be in one place. Alphabetical order scatters it: the
 * gazebos, the generator and the gels land together for no reason but their
 * first letter.
 *
 * Categories come out in the order the catalogue defines (its `sort`), not
 * alphabetically, because that order is itself the walk through the racks.
 * Anything uncategorised goes last rather than first, where it would be the
 * first thing read.
 */
export function groupByCategory<T>(
  rows: T[],
  categoryIdOf: (row: T) => string | null,
  categories: Category[],
): Array<[categoryId: string | null, rows: T[]]> {
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const buckets = new Map<string | null, T[]>();

  for (const row of rows) {
    const key = categoryIdOf(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  // An unknown category sorts just above uncategorised: it is a real grouping
  // the crew made, but nothing here can say where it belongs in the walk.
  const rank = (key: string | null) =>
    key === null ? Number.MAX_SAFE_INTEGER : (order.get(key) ?? Number.MAX_SAFE_INTEGER - 1);

  return [...buckets.entries()].sort(([a], [b]) => rank(a) - rank(b));
}

/** How a category heading reads: its icon and name, or a plain fallback. */
export function categoryLabel(
  categoryId: string | null,
  categories: Category[],
): string {
  const category = categories.find((entry) => entry.id === categoryId);
  return category ? `${category.icon} ${category.name}` : '📦 Uncategorised';
}
