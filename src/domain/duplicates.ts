import { db } from '../db/db';
import { alive, softDelete, softDeleteChildren, update } from '../db/repo';
import type { Item, Template } from '../db/types';

/**
 * Finding and merging duplicate records.
 *
 * Two phones that each seeded their own demo data, then synced, ended up with
 * two of everything. The same thing happens whenever someone adds an item that
 * already exists under a slightly different spelling. Wiping the device is not
 * an answer once there is real work on it, so duplicates need to be mergeable
 * in place.
 *
 * Nothing is ever hard-deleted, and quantities are never added together — two
 * records for one physical shelf are a naming problem, not twice the stock, and
 * guessing wrong there would corrupt the count silently.
 */

export interface DuplicateGroup<T> {
  /** What the records have in common — the SKU, or the name. */
  key: string;
  /** The one to keep: the earliest created, so history stays attached to it. */
  keep: T;
  /** The ones to fold into it. */
  drop: T[];
}

/** SKU if there is one, otherwise the name. Case and spacing are ignored. */
function itemKey(item: Item): string {
  const raw = item.sku.trim() || item.name.trim();
  return raw.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Oldest first, breaking ties on id.
 *
 * The tie-break is not cosmetic: two phones may each run the merge, and if they
 * disagreed about which copy survived they would then sync those disagreements
 * at each other. Records created in the same millisecond — which is exactly
 * what a bulk seed produces — must sort the same way on every device.
 */
function oldestFirst<T extends { createdAt: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function groupBy<T extends { createdAt: string; id: string }>(
  rows: T[],
  key: (row: T) => string,
): DuplicateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    buckets.set(value, [...(buckets.get(value) ?? []), row]);
  }
  const groups: DuplicateGroup<T>[] = [];
  for (const [value, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const [keep, ...drop] = oldestFirst(bucket);
    groups.push({ key: value, keep, drop });
  }
  return groups;
}

/** Items sharing a SKU, or a name where no SKU is set. */
export function findDuplicateItems(items: Item[]): DuplicateGroup<Item>[] {
  return groupBy(
    items.filter((item) => !item.archived),
    itemKey,
  );
}

export function findDuplicateTemplates(templates: Template[]): DuplicateGroup<Template>[] {
  return groupBy(templates, (template) => template.name.trim().toLowerCase());
}

export interface MergeSummary {
  itemsMerged: number;
  templatesMerged: number;
  /** References moved onto the surviving item. */
  referencesMoved: number;
}

/**
 * Point everything that referred to a dropped item at the one being kept, then
 * retire the duplicate. Packlists, templates, counts and the stock ledger all
 * carry an item id, and leaving any of them pointing at a retired record would
 * make lines render as "Unknown item".
 */
async function absorbItem(keepId: string, dropId: string): Promise<number> {
  let moved = 0;

  // Typed loosely on purpose: four unrelated row shapes share only `itemId`,
  // and spelling out the union buys nothing over one narrow cast here.
  const referring = [
    db.packlistLines,
    db.templateLines,
    db.stocktakeCounts,
    db.movements,
  ] as unknown as Array<{
    toArray(): Promise<Array<{ id: string; itemId: string; deletedAt: string | null }>>;
    get(id: string): Promise<{ id: string } | undefined>;
    put(row: unknown): Promise<unknown>;
  }>;

  for (const table of referring) {
    const rows = (await table.toArray()).filter(
      (row) => !row.deletedAt && row.itemId === dropId,
    );
    for (const row of rows) {
      await update(
        table as unknown as Parameters<typeof update>[0],
        row.id,
        { itemId: keepId } as never,
      );
      moved += 1;
    }
  }

  await update(db.items, dropId, { archived: true });
  await softDelete(db.items, dropId);
  return moved;
}

/** Merge every duplicate found. Safe to run repeatedly. */
export async function mergeDuplicates(): Promise<MergeSummary> {
  const summary: MergeSummary = { itemsMerged: 0, templatesMerged: 0, referencesMoved: 0 };

  const items = alive(await db.items.toArray());
  for (const group of findDuplicateItems(items)) {
    for (const duplicate of group.drop) {
      summary.referencesMoved += await absorbItem(group.keep.id, duplicate.id);
      summary.itemsMerged += 1;
    }
  }

  // A template's lines belong to it, so there is nothing to repoint — the
  // duplicate and its contents go together.
  const templates = alive(await db.templates.toArray());
  for (const group of findDuplicateTemplates(templates)) {
    for (const duplicate of group.drop) {
      await softDeleteChildren(db.templateLines, 'templateId', duplicate.id);
      await softDelete(db.templates, duplicate.id);
      summary.templatesMerged += 1;
    }
  }

  return summary;
}

/** How much duplication is sitting there, without changing anything. */
export async function countDuplicates(): Promise<{ items: number; templates: number }> {
  const [items, templates] = await Promise.all([
    alive(await db.items.toArray()),
    alive(await db.templates.toArray()),
  ]);
  return {
    items: findDuplicateItems(items).reduce((sum, group) => sum + group.drop.length, 0),
    templates: findDuplicateTemplates(templates).reduce((sum, group) => sum + group.drop.length, 0),
  };
}
