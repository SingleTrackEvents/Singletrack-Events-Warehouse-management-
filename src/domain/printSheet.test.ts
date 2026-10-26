import { describe, expect, it } from 'vitest';
import { sheetLine, sheetSummary, summaryText, vanGroups } from './printSheet';
import type { Destination, Packlist, PacklistLine } from '../db/types';

function line(id: string, qtyRequired: number, qtyPacked: number, extra: Partial<PacklistLine> = {}): PacklistLine {
  return { id, packlistId: 'p', itemId: id, qtyRequired, qtyPacked, qtyReturned: 0, ...extra } as PacklistLine;
}

function station(name: string, sort: number, extra: Partial<Destination> = {}): Destination {
  return { id: name, eventId: 'e', name, sort, ...extra } as Destination;
}

describe('a printed sheet line', () => {
  it('ticks an item packed in full', () => {
    expect(sheetLine(line('tables', 4, 4))).toMatchObject({ needed: 4, packed: 4, missing: 0, done: true });
  });

  it('marks an item packed short with how many are missing', () => {
    expect(sheetLine(line('chairs', 10, 6))).toMatchObject({ packed: 6, missing: 4, done: false });
  });

  it('marks an item never packed as all missing', () => {
    expect(sheetLine(line('esky', 2, 0))).toMatchObject({ packed: 0, missing: 2, done: false });
  });

  it('does not call extra packed a shortfall', () => {
    expect(sheetLine(line('water', 10, 12))).toMatchObject({ missing: 0, done: true });
  });

  it('never calls gear from another station missing', () => {
    const entry = sheetLine(line('marquee', 1, 0, { fromDestinationId: 'Mt Zero' }));
    expect(entry).toMatchObject({ missing: 0, done: false, fromStationId: 'Mt Zero' });
  });
});

describe('the summary at the top of a sheet', () => {
  const name = (entry: PacklistLine) => entry.itemId;

  it('counts packed items and names the missing ones', () => {
    const lines = [line('tables', 4, 4), line('esky', 2, 0), line('ice', 6, 3), line('cups', 100, 100)];
    const summary = sheetSummary(lines.map(sheetLine), name);
    expect(summary).toMatchObject({ total: 4, packed: 2, missing: ['esky', 'ice'] });
    expect(summaryText(summary)).toBe('2 of 4 items packed, 2 missing: esky, ice.');
  });

  it('leaves gear from other stations out of the count', () => {
    const lines = [line('tables', 4, 4), line('marquee', 1, 0, { fromDestinationId: 'x' })];
    const summary = sheetSummary(lines.map(sheetLine), name);
    expect(summary).toMatchObject({ total: 1, packed: 1, fromOtherStations: 1 });
    expect(summaryText(summary)).toBe('The one item is packed.');
  });

  it('says so when nothing is missing', () => {
    const summary = sheetSummary([line('a', 1, 1), line('b', 2, 2)].map(sheetLine), name);
    expect(summaryText(summary)).toBe('All 2 items packed.');
  });

  it('keeps a long missing list to a line', () => {
    const lines = Array.from({ length: 12 }, (_, at) => line(`item${at}`, 1, 0));
    const text = summaryText(sheetSummary(lines.map(sheetLine), name));
    expect(text).toMatch(/^0 of 12 items packed, 12 missing: item0, .*item7 and 4 more\.$/);
  });

  it('says when there is nothing to pack', () => {
    expect(summaryText(sheetSummary([], name))).toBe('No items for the warehouse to pack.');
  });
});

describe('stations grouped by vehicle', () => {
  const none = () => undefined as Packlist | undefined;

  it('groups by vehicle in the order they leave the yard', () => {
    const groups = vanGroups(
      [
        station('Bainggug', 3, { vehicle: 'Van 2', schedule: { departsAt: '2026-11-06T04:45' } as Destination['schedule'] }),
        station('Mt Zero', 1, { vehicle: 'Van 1', schedule: { departsAt: '2026-11-05T03:30' } as Destination['schedule'] }),
        station('Halls Gap', 2, { vehicle: 'van 1 ', schedule: { departsAt: '2026-11-05T06:00' } as Destination['schedule'] }),
      ],
      none,
    );
    expect(groups.map((group) => group.vehicle)).toEqual(['Van 1', 'Van 2']);
    expect(groups[0].stations.map((entry) => entry.destination.name)).toEqual(['Mt Zero', 'Halls Gap']);
  });

  it('follows course order when nobody has set a departure time', () => {
    const groups = vanGroups([station('B', 2, { vehicle: 'Hilux' }), station('A', 1, { vehicle: 'Hilux' })], none);
    expect(groups[0].stations.map((entry) => entry.destination.name)).toEqual(['A', 'B']);
  });

  it('puts stations with no vehicle last, under no vehicle', () => {
    const groups = vanGroups([station('A', 1), station('B', 2, { vehicle: 'Truck' }), station('C', 3, { vehicle: '  ' })], none);
    expect(groups.map((group) => group.vehicle)).toEqual(['Truck', null]);
    expect(groups[1].stations.map((entry) => entry.destination.name)).toEqual(['A', 'C']);
  });

  it('skips deleted stations and finds each station its list', () => {
    const list = { id: 'list-a' } as Packlist;
    const groups = vanGroups(
      [station('A', 1, { vehicle: 'Van' }), station('Gone', 2, { vehicle: 'Van', deletedAt: '2026-01-01' })],
      (destination) => (destination.name === 'A' ? list : undefined),
    );
    expect(groups[0].stations).toEqual([expect.objectContaining({ packlist: list })]);
  });
});
