import { db } from '../db/db';
import { create, createMany, liveWhere, nextSort, softDelete, update } from '../db/repo';
import type { Destination, Packlist, PacklistLine, PacklistStatus, Template, TemplateLine } from '../db/types';
import { makeCode } from './codes';
import { recordMovements, round2 } from './stock';

/**
 * Packlist lifecycle.
 *
 * draft → picking → packed → loaded → delivered → returned → reconciled
 *
 * The two transitions that touch stock are `loaded` (quantities leave the
 * warehouse) and `reconciled` (whatever came back goes on the shelf again).
 * Everything else is just crew progress.
 */

const ORDER: PacklistStatus[] = [
  'draft',
  'picking',
  'packed',
  'loaded',
  'delivered',
  'returned',
  'reconciled',
];

export const PACKLIST_STATUS_LABELS: Record<PacklistStatus, string> = {
  draft: 'Draft',
  picking: 'Picking',
  packed: 'Packed',
  loaded: 'Loaded',
  delivered: 'Delivered',
  returned: 'Returned',
  reconciled: 'Reconciled',
};

/** Wording for the button that moves a packlist to the next stage. */
export const NEXT_STATUS_ACTION: Partial<Record<PacklistStatus, string>> = {
  draft: 'Start picking',
  picking: 'Mark packed',
  packed: 'Mark loaded',
  loaded: 'Mark delivered',
  delivered: 'Mark returned',
  returned: 'Reconcile returns',
};

export function statusIndex(status: PacklistStatus): number {
  return ORDER.indexOf(status);
}

/** The stage that follows, or null at the end of the lifecycle. */
export function nextStatus(status: PacklistStatus): PacklistStatus | null {
  const index = statusIndex(status);
  return index >= 0 && index < ORDER.length - 1 ? ORDER[index + 1] : null;
}

/** True once stock has left the warehouse for this packlist. */
export function hasIssued(status: PacklistStatus): boolean {
  return statusIndex(status) >= statusIndex('loaded');
}

export interface Progress {
  linesTotal: number;
  linesDone: number;
  qtyRequired: number;
  qtyPacked: number;
  /** 0–100, based on lines fully packed. */
  percent: number;
  /** Mandatory lines that are still short. These block "mark packed". */
  blocking: PacklistLine[];
  /** Any line packed below its required quantity. */
  short: PacklistLine[];
}

/** How many of this line have been confirmed as arrived. */
export function received(line: PacklistLine): number {
  return line.qtyReceived ?? 0;
}

function summarise(lines: PacklistLine[], got: (line: PacklistLine) => number): Progress {
  const live = lines.filter((line) => !line.deletedAt);
  const short = live.filter((line) => got(line) < line.qtyRequired);
  const done = live.filter((line) => got(line) >= line.qtyRequired);
  return {
    linesTotal: live.length,
    linesDone: done.length,
    qtyRequired: round2(live.reduce((sum, line) => sum + line.qtyRequired, 0)),
    qtyPacked: round2(live.reduce((sum, line) => sum + got(line), 0)),
    percent: live.length ? Math.round((done.length / live.length) * 100) : 0,
    blocking: short.filter((line) => line.mandatory),
    short,
  };
}

/** Summarise how far through packing a list is. */
export function progressFor(lines: PacklistLine[]): Progress {
  return summarise(lines, (line) => line.qtyPacked);
}

/**
 * The same summary from the aid station's side: how much of the list has been
 * confirmed as having turned up. Kept separate from packing progress so a crate
 * the warehouse filled but nobody has checked still reads as unconfirmed.
 */
export function receiptFor(lines: PacklistLine[]): Progress {
  return summarise(lines, received);
}

/** Create an empty packlist for a destination, with its QR short code. */
export async function createPacklist(
  destination: Destination,
  name?: string,
): Promise<Packlist> {
  const listName = name?.trim() || destination.name;
  return create(db.packlists, {
    eventId: destination.eventId,
    destinationId: destination.id,
    name: listName,
    code: makeCode(listName),
    status: 'draft',
    packedBy: '',
    packedAt: null,
    deliveredAt: null,
    receivedBy: '',
    notes: '',
  });
}

/** Quantity a template line contributes, scaled by runner count where relevant. */
export function templateLineQty(line: TemplateLine, runners: number): number {
  if (!line.perRunner) return line.qty;
  return Math.ceil(line.qty * Math.max(0, runners));
}

/**
 * Copy a template onto a packlist. Existing lines for the same item have their
 * required quantity topped up rather than duplicated, so applying a second
 * template (say "wet weather extras") merges cleanly.
 */
export async function applyTemplate(
  packlistId: string,
  template: Template,
  runners = 0,
): Promise<number> {
  const [templateLines, existing] = await Promise.all([
    liveWhere(db.templateLines, 'templateId', template.id),
    liveWhere(db.packlistLines, 'packlistId', packlistId),
  ]);
  if (!templateLines.length) return 0;

  const byItem = new Map(existing.map((line) => [line.itemId, line]));
  let sort = nextSort(existing);
  const additions: Array<Omit<PacklistLine, keyof import('../db/types').SyncMeta>> = [];

  for (const templateLine of templateLines) {
    const qty = templateLineQty(templateLine, runners);
    if (qty <= 0) continue;
    const match = byItem.get(templateLine.itemId);
    if (match) {
      await update(db.packlistLines, match.id, {
        qtyRequired: round2(match.qtyRequired + qty),
        mandatory: match.mandatory || templateLine.mandatory,
      });
    } else {
      additions.push({
        packlistId,
        itemId: templateLine.itemId,
        qtyRequired: qty,
        qtyPacked: 0,
        qtyReturned: 0,
        mandatory: templateLine.mandatory,
        containerId: null,
        note: templateLine.note,
        sort,
      });
      sort += 10;
    }
  }

  if (additions.length) await createMany(db.packlistLines, additions);
  return templateLines.length;
}

/** Add a single item to a packlist, merging with an existing line for it. */
export async function addLine(
  packlistId: string,
  itemId: string,
  qty = 1,
): Promise<PacklistLine> {
  const existing = await liveWhere(db.packlistLines, 'packlistId', packlistId);
  const match = existing.find((line) => line.itemId === itemId);
  if (match) {
    const updated = await update(db.packlistLines, match.id, {
      qtyRequired: round2(match.qtyRequired + qty),
    });
    return updated ?? match;
  }
  return create(db.packlistLines, {
    packlistId,
    itemId,
    qtyRequired: qty,
    qtyPacked: 0,
    qtyReturned: 0,
    mandatory: false,
    containerId: null,
    note: '',
    sort: nextSort(existing),
  });
}

export async function removeLine(lineId: string): Promise<void> {
  await softDelete(db.packlistLines, lineId);
}

/**
 * Move a packlist to a new status, applying the stock side effects.
 *
 * Moving to `loaded` issues the packed quantities out of the warehouse; moving
 * to `reconciled` books the returned quantities back in. Both are idempotent —
 * re-running a transition that already happened writes nothing.
 */
export async function setStatus(
  packlist: Packlist,
  status: PacklistStatus,
  options: { by?: string; receivedBy?: string } = {},
): Promise<void> {
  const from = statusIndex(packlist.status);
  const to = statusIndex(status);
  if (to < 0 || to === from) return;

  const lines = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
  const changes: Partial<Packlist> = { status };

  if (status === 'packed' && !packlist.packedAt) {
    changes.packedAt = new Date().toISOString();
    changes.packedBy = options.by ?? packlist.packedBy;
  }
  if (status === 'delivered') {
    changes.deliveredAt = new Date().toISOString();
    if (options.receivedBy) changes.receivedBy = options.receivedBy;
  }

  // Crossing into `loaded` for the first time takes stock off the shelf.
  if (from < statusIndex('loaded') && to >= statusIndex('loaded')) {
    await recordMovements(
      lines
        .filter((line) => line.qtyPacked > 0)
        .map((line) => ({
          itemId: line.itemId,
          qty: -line.qtyPacked,
          reason: 'issue' as const,
          refType: 'packlist' as const,
          refId: packlist.id,
          note: packlist.name,
          by: options.by ?? '',
        })),
    );
  }

  // Reconciling books back whatever physically came home.
  if (status === 'reconciled' && packlist.status !== 'reconciled') {
    await recordMovements(
      lines
        .filter((line) => line.qtyReturned > 0)
        .map((line) => ({
          itemId: line.itemId,
          qty: line.qtyReturned,
          reason: 'return' as const,
          refType: 'packlist' as const,
          refId: packlist.id,
          note: packlist.name,
          by: options.by ?? '',
        })),
    );
  }

  await update(db.packlists, packlist.id, changes);
}

/** What was issued but never came back — consumed, lost or still on site. */
export function outstanding(lines: PacklistLine[]): PacklistLine[] {
  return lines.filter((line) => !line.deletedAt && line.qtyPacked > line.qtyReturned);
}
