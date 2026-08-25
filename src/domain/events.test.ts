import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create, createMany } from '../db/repo';
import {
  addDays,
  bumpYearInName,
  copyEvent,
  daysBetween,
  nextYearDefaults,
  previewCopy,
  sameWeekdayNextYear,
} from './events';
import type { RaceEvent } from '../db/types';

const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });

describe('sameWeekdayNextYear', () => {
  it('keeps the weekday rather than the calendar date', () => {
    // Saturday 5 September 2026 → Saturday 4 September 2027, not Sunday the 5th.
    expect(sameWeekdayNextYear('2026-09-05')).toBe('2027-09-04');
    expect(weekday('2026-09-05')).toBe('Saturday');
    expect(weekday('2027-09-04')).toBe('Saturday');
  });

  it('never drifts more than three days from the anniversary', () => {
    for (let day = 0; day < 400; day += 1) {
      const iso = addDays('2026-01-01', day);
      const next = sameWeekdayNextYear(iso);
      expect(weekday(next)).toBe(weekday(iso));
      const anniversary = `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
      expect(Math.abs(daysBetween(anniversary, next))).toBeLessThanOrEqual(3);
    }
  });

  it('handles a leap day without landing in March', () => {
    const next = sameWeekdayNextYear('2028-02-29');
    expect(next.startsWith('2029-02')).toBe(true);
    expect(weekday(next)).toBe(weekday('2028-02-29'));
  });

  it('leaves a date it cannot parse alone', () => {
    expect(sameWeekdayNextYear('')).toBe('');
  });
});

describe('bumpYearInName', () => {
  it('advances a year written into the name', () => {
    expect(bumpYearInName('GPT100 2026')).toBe('GPT100 2027');
    expect(bumpYearInName('Buffalo Stampede 2026 — Ultra')).toBe('Buffalo Stampede 2027 — Ultra');
  });

  it('leaves a name with no year alone', () => {
    expect(bumpYearInName('Buffalo Stampede')).toBe('Buffalo Stampede');
  });

  it('does not mistake a distance for a year', () => {
    expect(bumpYearInName('Alpine Challenge 100')).toBe('Alpine Challenge 100');
    expect(bumpYearInName('Razorback 2026 100')).toBe('Razorback 2027 100');
  });
});

describe('copyEvent', () => {
  let event: RaceEvent;

  beforeEach(async () => {
    event = await create(db.events, {
      name: 'Buffalo Stampede 2026',
      location: 'Bright, VIC',
      startDate: '2026-09-05',
      endDate: '2026-09-06',
      status: 'debrief',
      notes: 'Gate code 4471.',
    });

    const [village, aid] = await createMany(db.destinations, [
      {
        eventId: event.id,
        name: 'Event Village',
        type: 'event_village' as const,
        courseKm: null,
        access: '2wd' as const,
        accessNotes: 'Park behind the pub.',
        lat: null,
        lng: null,
        crewLead: 'Jess',
        phone: '',
        openTime: '05:00',
        closeTime: '18:00',
        notes: '',
        sort: 0,
      },
      {
        eventId: event.id,
        name: 'Aid 3 — Keppel Hut',
        type: 'aid_station' as const,
        courseKm: 42,
        access: '4wd' as const,
        accessNotes: 'Locked gate, 40 min from town.',
        lat: null,
        lng: null,
        crewLead: 'Sam',
        phone: '',
        openTime: '07:00',
        closeTime: '16:00',
        notes: '',
        sort: 1,
      },
    ]);

    const item = await create(db.items, {
      name: 'Water cube',
      sku: 'AS-WTR-CUBE',
      categoryId: null,
      unit: 'each' as const,
      packSize: 1,
      bin: 'Rack B',
      qtyOnHand: 20,
      minQty: 4,
      barcode: null,
      notes: '',
      consumable: false,
      archived: false,
    });

    const packlist = await create(db.packlists, {
      eventId: event.id,
      destinationId: aid.id,
      name: 'Aid 3 — Keppel Hut',
      code: 'AS3-7K2M',
      status: 'reconciled' as const,
      packedBy: 'Sam',
      packedAt: '2026-09-04T08:00:00.000Z',
      deliveredAt: '2026-09-05T05:30:00.000Z',
      receivedBy: 'Kate',
      notes: 'Second load took the gazebo.',
    });

    await create(db.packlistLines, {
      packlistId: packlist.id,
      itemId: item.id,
      qtyRequired: 4,
      qtyPacked: 4,
      qtyReceived: 3,
      qtyReturned: 3,
      mandatory: true,
      containerId: 'crate-1',
      note: '',
      sort: 0,
    });

    void village;
  });

  it('previews what will be copied', async () => {
    expect(await previewCopy(event.id)).toEqual({ destinations: 2, packlists: 1, lines: 1 });
  });

  it('copies destinations and packlists onto a new event', async () => {
    const copy = await copyEvent(event.id, nextYearDefaults(event));
    expect(copy).toBeDefined();
    if (!copy) return;

    expect(copy.id).not.toBe(event.id);
    expect(copy.name).toBe('Buffalo Stampede 2027');
    expect(copy.startDate).toBe('2027-09-04');
    // A two-day race stays two days long.
    expect(daysBetween(copy.startDate, copy.endDate)).toBe(1);
    expect(copy.status).toBe('planning');

    const destinations = alive(await db.destinations.where('eventId').equals(copy.id).toArray());
    expect(destinations.map((entry) => entry.name).sort()).toEqual([
      'Aid 3 — Keppel Hut',
      'Event Village',
    ]);
    const keppel = destinations.find((entry) => entry.name.startsWith('Aid 3'));
    expect(keppel?.accessNotes).toBe('Locked gate, 40 min from town.');
    expect(keppel?.courseKm).toBe(42);
  });

  it('leaves last year untouched', async () => {
    await copyEvent(event.id, nextYearDefaults(event));

    const original = await db.events.get(event.id);
    expect(original?.name).toBe('Buffalo Stampede 2026');
    expect(original?.startDate).toBe('2026-09-05');
    expect(original?.status).toBe('debrief');
    expect(alive(await db.destinations.where('eventId').equals(event.id).toArray())).toHaveLength(2);
    expect(alive(await db.packlists.where('eventId').equals(event.id).toArray())).toHaveLength(1);
  });

  it('carries required quantities but not what was packed, confirmed or returned', async () => {
    const copy = await copyEvent(event.id, nextYearDefaults(event));
    if (!copy) throw new Error('no copy');

    const packlists = alive(await db.packlists.where('eventId').equals(copy.id).toArray());
    expect(packlists).toHaveLength(1);
    const [packlist] = packlists;
    expect(packlist.status).toBe('draft');
    expect(packlist.packedBy).toBe('');
    expect(packlist.packedAt).toBeNull();
    expect(packlist.deliveredAt).toBeNull();
    expect(packlist.receivedBy).toBe('');
    // A reused code would send this year's crate to last year's label.
    expect(packlist.code).not.toBe('AS3-7K2M');

    const lines = alive(await db.packlistLines.toArray()).filter(
      (line) => line.packlistId === packlist.id,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].qtyRequired).toBe(4);
    expect(lines[0].qtyPacked).toBe(0);
    // Last year's aid station confirmed last year's crate. Carrying that
    // forward would open the new list already ticked off.
    expect(lines[0].qtyReceived).toBeNull();
    expect(lines[0].qtyReturned).toBe(0);
    expect(lines[0].containerId).toBeNull();
    expect(lines[0].mandatory).toBe(true);
  });

  it('can copy the shape without the packlists', async () => {
    const copy = await copyEvent(event.id, {
      ...nextYearDefaults(event),
      withPacklists: false,
    });
    if (!copy) throw new Error('no copy');

    expect(alive(await db.destinations.where('eventId').equals(copy.id).toArray())).toHaveLength(2);
    expect(alive(await db.packlists.where('eventId').equals(copy.id).toArray())).toHaveLength(0);
  });

  it('never moves stock', async () => {
    const before = await db.movements.count();
    await copyEvent(event.id, nextYearDefaults(event));
    expect(await db.movements.count()).toBe(before);
  });

  it('mirrors the start when the end date is earlier', async () => {
    const copy = await copyEvent(event.id, {
      ...nextYearDefaults(event),
      startDate: '2027-09-04',
      endDate: '2027-01-01',
    });
    expect(copy?.endDate).toBe('2027-09-04');
  });

  it('returns nothing for an event that does not exist', async () => {
    expect(await copyEvent('nope', nextYearDefaults(event))).toBeUndefined();
  });
});
