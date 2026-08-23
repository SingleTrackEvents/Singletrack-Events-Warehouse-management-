import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, createMany, liveWhere, update } from '../db/repo';
import {
  addLine,
  applyTemplate,
  hasIssued,
  nextStatus,
  outstanding,
  progressFor,
  setStatus,
  templateLineQty,
} from './packlists';
import type { Destination, Item, PacklistLine, Template } from '../db/types';

async function makeItem(sku: string, qtyOnHand = 100) {
  return create(db.items, {
    name: `Item ${sku}`,
    sku,
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: 'A1',
    qtyOnHand,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
  });
}

async function makeDestination(): Promise<Destination> {
  const event = await create(db.events, {
    name: 'Buffalo Stampede',
    location: 'Bright',
    startDate: '2026-04-04',
    endDate: '2026-04-04',
    status: 'packing',
    notes: '',
  });
  return create(db.destinations, {
    eventId: event.id,
    name: 'Aid 3 — Buffalo Plateau',
    type: 'aid_station',
    courseKm: 42,
    access: '4wd',
    accessNotes: '',
    lat: null,
    lng: null,
    crewLead: '',
    phone: '',
    openTime: '07:00',
    closeTime: '16:00',
    notes: '',
    sort: 10,
  });
}

async function makePacklist() {
  const destination = await makeDestination();
  const packlist = await create(db.packlists, {
    eventId: destination.eventId,
    destinationId: destination.id,
    name: destination.name,
    code: 'AS3-7K2M',
    status: 'draft',
    packedBy: '',
    packedAt: null,
    deliveredAt: null,
    receivedBy: '',
    notes: '',
  });
  return { destination, packlist };
}

async function makeTemplate(lines: Array<{ itemId: string; qty: number; mandatory?: boolean; perRunner?: boolean }>) {
  const template: Template = await create(db.templates, {
    name: 'Standard aid station',
    appliesTo: 'aid_station',
    description: '',
  });
  await createMany(
    db.templateLines,
    lines.map((line, index) => ({
      templateId: template.id,
      itemId: line.itemId,
      qty: line.qty,
      mandatory: line.mandatory ?? false,
      perRunner: line.perRunner ?? false,
      note: '',
      sort: (index + 1) * 10,
    })),
  );
  return template;
}

const line = (overrides: Partial<PacklistLine>): PacklistLine =>
  ({
    qtyRequired: 1,
    qtyPacked: 0,
    qtyReturned: 0,
    mandatory: false,
    deletedAt: null,
    ...overrides,
  }) as PacklistLine;

describe('progress', () => {
  it('counts a line done only once it is fully packed', () => {
    const progress = progressFor([
      line({ id: '1', qtyRequired: 4, qtyPacked: 4 }),
      line({ id: '2', qtyRequired: 4, qtyPacked: 2 }),
      line({ id: '3', qtyRequired: 4, qtyPacked: 0 }),
    ]);

    expect(progress.linesDone).toBe(1);
    expect(progress.linesTotal).toBe(3);
    expect(progress.percent).toBe(33);
    expect(progress.qtyPacked).toBe(6);
  });

  it('separates must-have shortfalls from ordinary ones', () => {
    const progress = progressFor([
      line({ id: '1', qtyRequired: 2, qtyPacked: 0, mandatory: true }),
      line({ id: '2', qtyRequired: 2, qtyPacked: 1 }),
    ]);

    expect(progress.short).toHaveLength(2);
    expect(progress.blocking).toHaveLength(1);
    expect(progress.blocking[0].id).toBe('1');
  });

  it('treats over-packing as done rather than negative progress', () => {
    const progress = progressFor([line({ id: '1', qtyRequired: 2, qtyPacked: 5 })]);
    expect(progress.percent).toBe(100);
    expect(progress.short).toHaveLength(0);
  });

  it('ignores tombstoned lines', () => {
    const progress = progressFor([
      line({ id: '1', qtyRequired: 1, qtyPacked: 1 }),
      line({ id: '2', qtyRequired: 1, qtyPacked: 0, deletedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(progress.linesTotal).toBe(1);
    expect(progress.percent).toBe(100);
  });
});

describe('lifecycle', () => {
  it('walks the stages in order and stops at the end', () => {
    expect(nextStatus('draft')).toBe('picking');
    expect(nextStatus('packed')).toBe('loaded');
    expect(nextStatus('reconciled')).toBeNull();
  });

  it('knows once stock has left the warehouse', () => {
    expect(hasIssued('packed')).toBe(false);
    expect(hasIssued('loaded')).toBe(true);
    expect(hasIssued('delivered')).toBe(true);
  });
});

describe('applying a template', () => {
  it('creates a line per template entry', async () => {
    const { packlist } = await makePacklist();
    const water = await makeItem('WATER');
    const gels = await makeItem('GELS');
    const template = await makeTemplate([
      { itemId: water.id, qty: 4, mandatory: true },
      { itemId: gels.id, qty: 2 },
    ]);

    await applyTemplate(packlist.id, template);
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);

    expect(lines).toHaveLength(2);
    expect(lines.find((entry) => entry.itemId === water.id)!.qtyRequired).toBe(4);
    expect(lines.find((entry) => entry.itemId === water.id)!.mandatory).toBe(true);
  });

  it('tops up an existing line instead of duplicating the item', async () => {
    const { packlist } = await makePacklist();
    const water = await makeItem('WATER');
    await addLine(packlist.id, water.id, 3);
    const template = await makeTemplate([{ itemId: water.id, qty: 4, mandatory: true }]);

    await applyTemplate(packlist.id, template);
    const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);

    expect(lines).toHaveLength(1);
    expect(lines[0].qtyRequired).toBe(7);
    // Must-have on either side wins, so stacking templates cannot downgrade it.
    expect(lines[0].mandatory).toBe(true);
  });

  it('scales per-runner lines by the expected field', () => {
    const perRunner = { qty: 0.5, perRunner: true } as never;
    const flat = { qty: 4, perRunner: false } as never;

    expect(templateLineQty(perRunner, 210)).toBe(105);
    expect(templateLineQty(flat, 210)).toBe(4);
    // Rounds up: half a carton of gels is still a carton off the shelf.
    expect(templateLineQty({ qty: 0.5, perRunner: true } as never, 11)).toBe(6);
  });
});

describe('status changes and stock', () => {
  it('issues packed quantities out of the warehouse on load', async () => {
    const { packlist } = await makePacklist();
    const water = await makeItem('WATER', 20);
    await addLine(packlist.id, water.id, 4);
    const [entry] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...entry, qtyPacked: 4 });

    await setStatus(packlist, 'loaded', { by: 'Dan' });

    expect((await db.items.get(water.id))!.qtyOnHand).toBe(16);
    const movements = await db.movements.where('itemId').equals(water.id).toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('issue');
    expect(movements[0].refId).toBe(packlist.id);
  });

  it('does not issue the same stock twice as the list moves on', async () => {
    const { packlist } = await makePacklist();
    const water = await makeItem('WATER', 20);
    await addLine(packlist.id, water.id, 4);
    const [entry] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...entry, qtyPacked: 4 });

    await setStatus(packlist, 'loaded');
    const loaded = (await db.packlists.get(packlist.id))!;
    await setStatus(loaded, 'delivered');

    expect((await db.items.get(water.id))!.qtyOnHand).toBe(16);
    expect(await db.movements.count()).toBe(1);
  });

  it('books returns back into stock when reconciled', async () => {
    const { packlist } = await makePacklist();
    const gazebo = await makeItem('GAZ', 10);
    await addLine(packlist.id, gazebo.id, 2);
    const [entry] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...entry, qtyPacked: 2, qtyReturned: 2 });

    await setStatus(packlist, 'loaded');
    expect((await db.items.get(gazebo.id))!.qtyOnHand).toBe(8);

    const returned = (await db.packlists.get(packlist.id))!;
    await setStatus(returned, 'reconciled');

    expect((await db.items.get(gazebo.id))!.qtyOnHand).toBe(10);
  });

  it('leaves consumed stock off the shelf when less comes back than went out', async () => {
    const { packlist } = await makePacklist();
    const gels = await makeItem('GELS', 10);
    await addLine(packlist.id, gels.id, 6);
    const [entry] = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    await db.packlistLines.put({ ...entry, qtyPacked: 6, qtyReturned: 2 });

    await setStatus(packlist, 'loaded');
    const loaded = (await db.packlists.get(packlist.id))!;
    await setStatus(loaded, 'reconciled');

    // 10 − 6 issued + 2 returned = 6; the missing 4 were eaten at the station.
    expect((await db.items.get(gels.id))!.qtyOnHand).toBe(6);
  });

  it('stamps who packed it and when', async () => {
    const { packlist } = await makePacklist();
    await setStatus(packlist, 'packed', { by: 'Jess' });

    const saved = (await db.packlists.get(packlist.id))!;
    expect(saved.status).toBe('packed');
    expect(saved.packedBy).toBe('Jess');
    expect(saved.packedAt).not.toBeNull();
  });

  it('records who signed for a delivery', async () => {
    const { packlist } = await makePacklist();
    await setStatus(packlist, 'delivered', { receivedBy: 'Priya' });

    const saved = (await db.packlists.get(packlist.id))!;
    expect(saved.receivedBy).toBe('Priya');
    expect(saved.deliveredAt).not.toBeNull();
  });
});

describe('outstanding gear', () => {
  it('lists what went out and has not come back', () => {
    const rows = outstanding([
      line({ id: '1', qtyPacked: 4, qtyReturned: 4 }),
      line({ id: '2', qtyPacked: 4, qtyReturned: 1 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['2']);
  });
});

describe('adding lines by hand', () => {
  it('merges a repeat add into the existing line', async () => {
    const { packlist } = await makePacklist();
    const item: Item = await makeItem('WATER');

    await addLine(packlist.id, item.id, 2);
    await addLine(packlist.id, item.id, 3);

    const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].qtyRequired).toBe(5);
  });
});

describe('changing what a stop needs', () => {
  const line = (over: Partial<PacklistLine> = {}): PacklistLine =>
    ({
      id: 'l1', createdAt: '', updatedAt: '', deletedAt: null, rev: 1, deviceId: '', syncedAt: null,
      packlistId: 'p1', itemId: 'i1', qtyRequired: 4, qtyPacked: 0, qtyReturned: 0,
      mandatory: true, containerId: null, note: '', sort: 10,
      ...over,
    }) as PacklistLine;

  it('reopens a line when the requirement rises above what is packed', async () => {
    const stored = await create(db.packlistLines, {
      packlistId: 'p1', itemId: 'i1', qtyRequired: 4, qtyPacked: 4, qtyReturned: 0,
      mandatory: true, containerId: null, note: '', sort: 10,
    });
    expect(progressFor([stored]).linesDone).toBe(1);

    // Four in the crate, six now needed: the line is short again and says so.
    const raised = (await update(db.packlistLines, stored.id, { qtyRequired: 6 }))!;
    const progress = progressFor([raised]);
    expect(progress.linesDone).toBe(0);
    expect(progress.short).toHaveLength(1);
    expect(progress.blocking).toHaveLength(1);
  });

  it('counts a line packed when the requirement drops to what is already in', () => {
    // Six packed against a requirement lowered to two. The extra stays in the
    // crate; nothing is taken out, and the line is not short.
    const progress = progressFor([line({ qtyRequired: 2, qtyPacked: 6 })]);
    expect(progress.linesDone).toBe(1);
    expect(progress.short).toHaveLength(0);
    expect(progress.qtyRequired).toBe(2);
    expect(progress.qtyPacked).toBe(6);
  });

  it('tracks the totals off the changed requirement', () => {
    const lines = [line({ qtyRequired: 6, qtyPacked: 4 }), line({ id: 'l2', qtyRequired: 1, qtyPacked: 1 })];
    const progress = progressFor(lines);
    expect(progress.qtyRequired).toBe(7);
    expect(progress.qtyPacked).toBe(5);
    expect(progress.percent).toBe(50);
  });
});
