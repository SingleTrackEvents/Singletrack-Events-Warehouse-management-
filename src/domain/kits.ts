import { db } from '../db/db';
import { update } from '../db/repo';
import type { Item, KitContent } from '../db/types';

/**
 * Kits: items that are boxes of other items.
 *
 * The Primary Aid Station Kit is three black tubs and a laminated contents
 * list. On a packlist it is one line — the kit goes on the truck as one thing
 * and comes off stock as one thing — but whoever fills the tubs needs the
 * list, and whoever unpacks them at the station needs to know what should be
 * inside. So a kit carries its contents, and packing the kit line is taken to
 * mean everything inside it is packed too.
 */

export function isKit(item: Item | undefined): boolean {
  return Boolean(item?.contents?.length);
}

/** One line of a kit, resolved against the catalogue. */
export interface KitLine {
  item: Item | undefined;
  itemId: string;
  qty: number;
}

/**
 * The contents of a kit, resolved, and multiplied for however many kits a
 * packlist line calls for: two kits means eight jugs, not four.
 */
export function kitLines(
  kit: Item | undefined,
  items: Map<string, Item>,
  kits = 1,
): KitLine[] {
  return (kit?.contents ?? []).map((content) => ({
    item: items.get(content.itemId),
    itemId: content.itemId,
    qty: content.qty * Math.max(1, kits),
  }));
}

/**
 * Add an item to a kit, or top up its quantity if it is already inside.
 *
 * A kit may not contain itself, nor another kit: three tubs holding three tubs
 * is not a thing that happens in the shed, and letting it happen here would
 * make the contents list recursive. Kept to one level on purpose.
 */
export async function addKitContent(
  kitId: string,
  itemId: string,
  qty: number,
): Promise<KitContent[] | undefined> {
  if (kitId === itemId || qty <= 0) return undefined;
  const [kit, inside] = await Promise.all([db.items.get(kitId), db.items.get(itemId)]);
  if (!kit || !inside || isKit(inside)) return undefined;

  const current = kit.contents ?? [];
  const existing = current.find((content) => content.itemId === itemId);
  const contents = existing
    ? current.map((content) =>
        content.itemId === itemId ? { ...content, qty: content.qty + qty } : content,
      )
    : [...current, { itemId, qty }];
  await update(db.items, kitId, { contents });
  return contents;
}

/** Set exactly how many of an item a kit holds; zero takes it out. */
export async function setKitContentQty(
  kitId: string,
  itemId: string,
  qty: number,
): Promise<KitContent[] | undefined> {
  const kit = await db.items.get(kitId);
  if (!kit) return undefined;
  const contents = (kit.contents ?? [])
    .map((content) => (content.itemId === itemId ? { ...content, qty } : content))
    .filter((content) => content.qty > 0);
  await update(db.items, kitId, { contents });
  return contents;
}

export async function removeKitContent(kitId: string, itemId: string): Promise<void> {
  await setKitContentQty(kitId, itemId, 0);
}
