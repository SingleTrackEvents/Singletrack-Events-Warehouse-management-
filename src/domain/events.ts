import { db } from '../db/db';
import { alive, create, createMany } from '../db/repo';
import type { Destination, RaceEvent, SyncMeta } from '../db/types';
import { makeCode } from './codes';

/**
 * Rolling an event over to next year.
 *
 * A race is largely the same event every year — the same aid stations, the same
 * access notes, roughly the same gear. Rebuilding all of that by hand each
 * season is the sort of work that pushes crews back to a spreadsheet, so the
 * whole shape can be copied forward and then adjusted.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates. Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * The same date next year, snapped to the same day of the week.
 *
 * Trail races run on a weekend, not on a date. A race on Saturday 5 September
 * 2026 belongs on Saturday 4 September 2027, not on the 5th, which is a Sunday.
 * So take the anniversary and move to the nearest day carrying the original's
 * weekday — three days either way at most.
 */
export function sameWeekdayNextYear(iso: string, years = 1): string {
  const source = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(source.getTime())) return iso;

  const target = new Date(source.getTime());
  target.setUTCFullYear(source.getUTCFullYear() + years);
  // 29 February rolls forward into March; step back so a leap day lands on the
  // 28th before the weekday is considered.
  if (target.getUTCDate() !== source.getUTCDate()) target.setUTCDate(0);

  const drift = (source.getUTCDay() - target.getUTCDay() + 7) % 7;
  target.setUTCDate(target.getUTCDate() + (drift > 3 ? drift - 7 : drift));
  return target.toISOString().slice(0, 10);
}

/** Shift an ISO date by whole days. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Bump a year written into a name: "GPT100 2026" becomes "GPT100 2027".
 *
 * Only the last plausible year is touched, so "Aid 2 2026" keeps its 2. A name
 * with no year is returned unchanged — appending one would rename every race
 * the crew already knows by its own name.
 */
export function bumpYearInName(name: string, years = 1): string {
  const matches = [...name.matchAll(/\b(20\d{2})\b/g)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return name;
  const bumped = String(Number(last[1]) + years);
  return name.slice(0, last.index) + bumped + name.slice(last.index + last[1].length);
}

export interface CopyEventOptions {
  name: string;
  location: string;
  startDate: string;
  /** Blank or earlier than the start mirrors the start, as elsewhere. */
  endDate: string;
  /** Carry the packlists over as required quantities. */
  withPacklists: boolean;
}

/** What a copy would produce, so the confirmation can name it. */
export interface CopyPreview {
  destinations: number;
  packlists: number;
  lines: number;
}

export async function previewCopy(eventId: string): Promise<CopyPreview> {
  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
  const allLines = alive(await db.packlistLines.toArray());
  const ids = new Set(packlists.map((packlist) => packlist.id));
  return {
    destinations: destinations.length,
    packlists: packlists.length,
    lines: allLines.filter((line) => ids.has(line.packlistId)).length,
  };
}

/** Sensible starting values for next year's copy of an event. */
export function nextYearDefaults(event: RaceEvent, years = 1): CopyEventOptions {
  const startDate = sameWeekdayNextYear(event.startDate, years);
  // Keep the length of the race weekend rather than the calendar dates.
  const span = Math.max(0, daysBetween(event.startDate, event.endDate));
  return {
    name: bumpYearInName(event.name, years),
    location: event.location,
    startDate,
    endDate: addDays(startDate, span),
    withPacklists: true,
  };
}

/**
 * Copy an event, its destinations and optionally its packlists.
 *
 * What is deliberately not copied: anything recording what physically happened.
 * Packed and returned quantities reset to zero, crates are not recreated, and no
 * stock moves — next year's list is a plan, and starting it pre-ticked would be
 * a lie about gear nobody has touched yet.
 */
export async function copyEvent(
  eventId: string,
  options: CopyEventOptions,
): Promise<RaceEvent | undefined> {
  const source = await db.events.get(eventId);
  if (!source) return undefined;

  const startDate = options.startDate;
  const endDate = options.endDate && options.endDate >= startDate ? options.endDate : startDate;

  const event = await create(db.events, {
    name: options.name.trim() || source.name,
    location: options.location.trim(),
    startDate,
    endDate,
    // However far last year's got, this one starts at the beginning.
    status: 'planning',
    notes: source.notes,
  });

  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  const copied = await createMany(
    db.destinations,
    destinations.map((destination) => ({ ...stripMeta(destination), eventId: event.id })),
  );

  // Old destination id → its copy, so each packlist lands at the right station.
  const destinationMap = new Map<string, Destination>();
  destinations.forEach((destination, index) => {
    const copy = copied[index];
    if (copy) destinationMap.set(destination.id, copy);
  });

  if (options.withPacklists) {
    const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
    const allLines = alive(await db.packlistLines.toArray());

    for (const packlist of packlists) {
      const destination = destinationMap.get(packlist.destinationId);
      if (!destination) continue;

      const copy = await create(db.packlists, {
        ...stripMeta(packlist),
        eventId: event.id,
        destinationId: destination.id,
        // A fresh code: the old one is printed on last year's crates, and two
        // packlists answering to one label is how gear ends up at the wrong hut.
        code: makeCode(destination.name),
        status: 'draft',
        packedBy: '',
        packedAt: null,
        deliveredAt: null,
        receivedBy: '',
      });

      await createMany(
        db.packlistLines,
        allLines
          .filter((line) => line.packlistId === packlist.id)
          .map((line) => ({
            ...stripMeta(line),
            packlistId: copy.id,
            // What was required is knowledge worth keeping. What was packed and
            // returned describes last year's crates and does not carry over.
            qtyPacked: 0,
            qtyReturned: 0,
            containerId: null,
          })),
      );
    }
  }

  return event;
}

/**
 * Drop the sync bookkeeping before re-inserting a row.
 *
 * Not cosmetic: the repo layer merges what it is given over a fresh stamp, so a
 * spread that kept `id` would overwrite the original record instead of copying
 * it — the copy would eat last year's event.
 */
function stripMeta<T extends SyncMeta>(row: T): Omit<T, keyof SyncMeta> {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    rev: _rev,
    deviceId: _deviceId,
    syncedAt: _syncedAt,
    ...rest
  } = row;
  return rest;
}
