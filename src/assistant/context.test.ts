import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create } from '../db/repo';
import { addLine, createPacklist, setStatus } from '../domain/packlists';
import {
  buildCheckRequest,
  normaliseName,
  pickHistory,
  pickSiblings,
  relevantTemplates,
  renderCatalogue,
  renderPacklist,
  renderStation,
} from './context';
import { addNote } from './notes';
import type { Destination, Item, Packlist, PacklistLine, RaceEvent, Template } from '../db/types';

async function item(name: string, extra: Partial<Item> = {}) {
  return create(db.items, {
    name,
    sku: extra.sku ?? name.toUpperCase().replace(/\s+/g, '-'),
    categoryId: null,
    unit: 'each',
    packSize: 1,
    bin: 'A1',
    qtyOnHand: 10,
    minQty: 0,
    barcode: null,
    notes: '',
    consumable: false,
    archived: false,
    ...extra,
  });
}

async function event(name: string, startDate: string) {
  return create(db.events, {
    name, location: 'Blackheath, NSW', startDate, endDate: startDate, status: 'packing', notes: '',
  });
}

async function destination(eventId: string, name: string, extra: Partial<Destination> = {}) {
  return create(db.destinations, {
    eventId, name, type: 'aid_station', courseKm: 12, access: '4wd', accessNotes: 'Gate code 1234',
    lat: null, lng: null, crewLead: 'Sam', phone: '', openTime: '06:30', closeTime: '14:00',
    notes: '', sort: 10, ...extra,
  });
}

describe('rendering the catalogue', () => {
  it('leads every line with the code and unfolds kits', async () => {
    const jug = await item('Water jug', { sku: 'WTR-JUG' });
    const kit = await item('Aid station kit', {
      sku: 'KIT-AS',
      contents: [{ itemId: jug.id, qty: 2 }],
      notes: 'Three black tubs',
    });
    const text = renderCatalogue([jug, kit], []);
    expect(text).toContain('WTR-JUG | Water jug | Uncategorised | each | asset');
    expect(text).toContain('KIT-AS | Aid station kit');
    expect(text).toContain('kit containing: 2 Water jug');
    expect(text).toContain('note: Three black tubs');
  });

  it('leaves out archived items, which the crew cannot pack', async () => {
    const gone = await item('Old marquee', { archived: true });
    expect(renderCatalogue([gone], [])).not.toContain('Old marquee');
  });
});

describe('describing the station', () => {
  it('says what kind of place it is, how to get there and who runs through it', async () => {
    const ev = await event('Hounslow Classic 2026', '2026-09-12');
    const dest = await destination(ev.id, 'Grand Canyon Carpark', { access: 'foot' });
    const race = await create(db.races, { eventId: ev.id, name: 'Marathon', projection: 450, sort: 10, day: '2026-09-12' });
    const withVisits = { ...dest, raceVisits: [{ raceId: race.id, passes: 2 }] };
    const text = renderStation({ event: ev, destination: withVisits, races: [race] });
    expect(text).toContain('Grand Canyon Carpark, an aid station at 12 km');
    expect(text).toContain('Walk-in. Gate code 1234');
    expect(text).toContain('Marathon (450 runners, 2 passes, 2026-09-12)');
    expect(text).toContain('About 900 runner passes in total');
  });
});

describe('describing the list', () => {
  it('shows required, packed and must-have per line', async () => {
    const tables = await item('Trestle table', { sku: 'TBL' });
    const packlist = { id: 'pl', name: 'Aid 3', code: 'AS3-7K2M', status: 'picking', notes: 'Extra water' } as Packlist;
    const line = {
      id: 'l1', itemId: tables.id, qtyRequired: 4, qtyPacked: 2, mandatory: true, note: 'from the trailer', deletedAt: null,
    } as PacklistLine;
    const text = renderPacklist(packlist, [line], new Map([[tables.id, tables]]));
    expect(text).toContain('status picking, 1 lines. Notes: Extra water');
    expect(text).toContain('TBL | Trestle table | required 4 | packed 2 | must-have | note: from the trailer');
  });

  it('says plainly when the list is empty', () => {
    const packlist = { id: 'pl', name: 'Aid 3', code: 'AS3', status: 'draft', notes: '' } as Packlist;
    expect(renderPacklist(packlist, [], new Map())).toContain('The list is empty.');
  });
});

describe('choosing templates', () => {
  const template = (overrides: Partial<Template>): Template =>
    ({ id: 'tpl', name: 'T', appliesTo: 'aid_station', description: '', deletedAt: null, ...overrides }) as Template;
  const dest = { type: 'aid_station', access: '4wd' } as Destination;

  it('takes templates for this kind of destination and its access', () => {
    const picked = relevantTemplates(
      [
        { template: template({ id: 'std' }), lines: [] },
        { template: template({ id: 'walk', suitsAccess: ['foot'] }), lines: [] },
        { template: template({ id: '4wd', suitsAccess: ['4wd', 'atv'] }), lines: [] },
        { template: template({ id: 'village', appliesTo: 'event_village' }), lines: [] },
        { template: template({ id: 'truck', scope: 'event' }), lines: [] },
      ],
      dest,
    );
    expect(picked.map((entry) => entry.template.id)).toEqual(['std', '4wd']);
  });
});

describe('finding earlier editions of a station', () => {
  const ev = (id: string, startDate: string) => ({ id, name: id, startDate }) as RaceEvent;
  const dest = (id: string, eventId: string, name: string, type = 'aid_station') =>
    ({ id, eventId, name, type, access: '4wd' }) as Destination;
  const lines = [{ id: 'x', deletedAt: null }] as PacklistLine[];
  const packlist = { id: 'p', status: 'loaded' } as Packlist;

  it('treats punctuation, case and a year as the same name', () => {
    expect(normaliseName('Aid 3 – Buffalo Plateau')).toBe('aid 3 buffalo plateau');
    expect(normaliseName('AID 3 BUFFALO PLATEAU 2025')).toBe('aid 3 buffalo plateau');
  });

  it('picks the same-named station at other events, most recent first, and skips empty lists', () => {
    const here = { event: ev('2026', '2026-09-12'), destination: dest('d-now', '2026', 'Grand Canyon Carpark') };
    const history = pickHistory(here, [
      { event: ev('2024', '2024-09-14'), destination: dest('d24', '2024', 'grand canyon carpark'), packlist, lines },
      { event: ev('2025', '2025-09-13'), destination: dest('d25', '2025', 'Grand Canyon Carpark'), packlist, lines },
      { event: ev('2023', '2023-09-16'), destination: dest('d23', '2023', 'Grand Canyon Carpark'), packlist, lines: [] },
      { event: ev('2025', '2025-09-13'), destination: dest('d25b', '2025', 'Perrys Lookdown'), packlist, lines },
      { event: ev('2026', '2026-09-12'), destination: dest('d-now', '2026', 'Grand Canyon Carpark'), packlist, lines },
    ]);
    expect(history.map((entry) => entry.destination.id)).toEqual(['d25', 'd24']);
  });

  it('picks sibling stations of the same kind at this event', () => {
    const here = { event: ev('2026', '2026-09-12'), destination: dest('d1', '2026', 'Aid 1') };
    const siblings = pickSiblings(here, [
      { event: ev('2026', '2026-09-12'), destination: dest('d2', '2026', 'Aid 2'), packlist, lines },
      { event: ev('2026', '2026-09-12'), destination: dest('village', '2026', 'Village', 'event_village'), packlist, lines },
      { event: ev('2025', '2025-09-13'), destination: dest('old', '2025', 'Aid 2'), packlist, lines },
    ]);
    expect(siblings.map((entry) => entry.destination.id)).toEqual(['d2']);
  });
});

describe('building the whole request from the database', () => {
  it('gathers the station, its list, last year’s list and the notes that apply', async () => {
    const jug = await item('Water jug', { sku: 'WTR-JUG' });
    const gen = await item('Generator', { sku: 'PWR-GEN' });

    const last = await event('Hounslow Classic 2025', '2025-09-13');
    const lastDest = await destination(last.id, 'Grand Canyon Carpark');
    const lastList = await createPacklist(lastDest);
    await addLine(lastList.id, gen.id, 1);
    await db.packlistLines.where('packlistId').equals(lastList.id).modify({ qtyPacked: 1 });
    await setStatus(lastList, 'loaded');

    const now = await event('Hounslow Classic 2026', '2026-09-12');
    const dest = await destination(now.id, 'Grand Canyon Carpark');
    const list = await createPacklist(dest);
    await addLine(list.id, jug.id, 6);

    await addNote({ text: 'Grand Canyon Carpark has no power.', eventId: null, destinationType: 'aid_station' });
    await addNote({ text: 'Village runs the big marquee.', destinationType: 'event_village' });
    await addNote({ text: 'Buffalo only.', eventId: 'some-other-event' });

    const request = await buildCheckRequest(list.id);
    expect(request?.kind).toBe('check');
    expect(request?.catalogue).toContain('PWR-GEN | Generator');
    expect(request?.station).toContain('Hounslow Classic 2026');
    expect(request?.packlist).toContain('WTR-JUG | Water jug | required 6');
    expect(request?.history).toContain('Hounslow Classic 2025, Grand Canyon Carpark');
    expect(request?.history).toContain('these quantities left the warehouse');
    expect(request?.history).toContain('PWR-GEN | Generator | 1');
    expect(request?.notes).toContain('[Aid station lists] Grand Canyon Carpark has no power.');
    expect(request?.notes).not.toContain('marquee');
    expect(request?.notes).not.toContain('Buffalo only');
  });

  it('returns nothing for a list that is not on this phone', async () => {
    expect(await buildCheckRequest('missing')).toBeUndefined();
  });
});
