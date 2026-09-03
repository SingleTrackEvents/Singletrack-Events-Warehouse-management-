import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create } from '../db/repo';
import { addKitContent, isKit, kitLines, removeKitContent, setKitContentQty } from './kits';
import type { Item } from '../db/types';

async function makeItem(name: string, contents?: Item['contents']): Promise<Item> {
  return create(db.items, {
    name,
    sku: name.toUpperCase().slice(0, 6),
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: '',
    qtyOnHand: 0,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
    ...(contents ? { contents } : {}),
  });
}

describe('isKit', () => {
  it('is true only for an item with something inside', async () => {
    const jug = await makeItem('Jug');
    expect(isKit(jug)).toBe(false);
    expect(isKit(await makeItem('Empty kit', []))).toBe(false);
    expect(isKit(await makeItem('Kit', [{ itemId: jug.id, qty: 4 }]))).toBe(true);
    expect(isKit(undefined)).toBe(false);
  });
});

describe('kitLines', () => {
  it('resolves the contents and scales them for several kits', async () => {
    const jug = await makeItem('Jug');
    const kit = await makeItem('Kit', [{ itemId: jug.id, qty: 4 }]);
    const items = new Map([[jug.id, jug]]);
    expect(kitLines(kit, items)).toEqual([{ item: jug, itemId: jug.id, qty: 4 }]);
    // Two kits on a packlist line means eight jugs to find, not four.
    expect(kitLines(kit, items, 2)[0].qty).toBe(8);
  });

  it('keeps a line whose item has gone, so the gap is visible', async () => {
    const kit = await makeItem('Kit', [{ itemId: 'gone', qty: 1 }]);
    const [line] = kitLines(kit, new Map());
    expect(line.item).toBeUndefined();
    expect(line.qty).toBe(1);
  });
});

describe('addKitContent', () => {
  it('adds an item, and tops it up rather than listing it twice', async () => {
    const kit = await makeItem('Kit');
    const jug = await makeItem('Jug');
    await addKitContent(kit.id, jug.id, 2);
    const after = await addKitContent(kit.id, jug.id, 2);
    expect(after).toEqual([{ itemId: jug.id, qty: 4 }]);
  });

  it('refuses to put a kit inside itself, or a kit inside a kit', async () => {
    const jug = await makeItem('Jug');
    const inner = await makeItem('Inner', [{ itemId: jug.id, qty: 1 }]);
    const outer = await makeItem('Outer');
    expect(await addKitContent(outer.id, outer.id, 1)).toBeUndefined();
    expect(await addKitContent(outer.id, inner.id, 1)).toBeUndefined();
    expect((await db.items.get(outer.id))?.contents).toBeUndefined();
  });

  it('ignores nothing and less than nothing', async () => {
    const kit = await makeItem('Kit');
    const jug = await makeItem('Jug');
    expect(await addKitContent(kit.id, jug.id, 0)).toBeUndefined();
  });
});

describe('setKitContentQty and removeKitContent', () => {
  it('sets a quantity exactly, and zero takes the line out', async () => {
    const jug = await makeItem('Jug');
    const tongs = await makeItem('Tongs');
    const kit = await makeItem('Kit', [
      { itemId: jug.id, qty: 4 },
      { itemId: tongs.id, qty: 4 },
    ]);
    expect(await setKitContentQty(kit.id, jug.id, 3)).toEqual([
      { itemId: jug.id, qty: 3 },
      { itemId: tongs.id, qty: 4 },
    ]);
    await removeKitContent(kit.id, tongs.id);
    expect((await db.items.get(kit.id))?.contents).toEqual([{ itemId: jug.id, qty: 3 }]);
  });

  it('leaves an emptied kit as an empty list, not as never-set', async () => {
    // The seed treats "never set" as its cue to fill the kit in; an empty
    // list is the crew's decision and must survive the next boot.
    const jug = await makeItem('Jug');
    const kit = await makeItem('Kit', [{ itemId: jug.id, qty: 1 }]);
    await removeKitContent(kit.id, jug.id);
    expect((await db.items.get(kit.id))?.contents).toEqual([]);
  });
});
