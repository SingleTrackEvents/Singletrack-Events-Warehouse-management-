import { describe, expect, it } from 'vitest';
import type { PacklistLine } from '../db/types';
import { boardCounts, countAt, currentMove, expectedHome, moveOf, moveProgress, movesFor, sent, used } from './moves';

function line(partial: Partial<PacklistLine> = {}): PacklistLine {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    deviceId: 'test',
    syncedAt: null,
    packlistId: 'p1',
    itemId: 'i1',
    qtyRequired: 4,
    qtyPacked: 0,
    qtyReturned: 0,
    mandatory: false,
    containerId: null,
    note: '',
    sort: 10,
    ...partial,
  };
}

describe('movesFor', () => {
  it('skips the van move on an event loaded straight from the shed', () => {
    expect(movesFor(true)).toEqual(['plan', 'truck', 'vans', 'station', 'home']);
    expect(movesFor(false)).toEqual(['plan', 'truck', 'station', 'home']);
  });
});

describe('moveOf on a truck-then-vans event', () => {
  it('is planned until something goes on the truck', () => {
    expect(moveOf([line()], true)).toBe('plan');
    expect(moveOf([line({ qtyOnTruck: 2 })], true)).toBe('truck');
  });

  it('is in the van once a van pack starts', () => {
    expect(moveOf([line({ qtyOnTruck: 4, qtyPacked: 1 })], true)).toBe('vans');
  });

  it('is at the station once anything is checked in or counted', () => {
    expect(moveOf([line({ qtyOnTruck: 4, qtyPacked: 4, qtyReceived: 3 })], true)).toBe('station');
    expect(moveOf([line({ qtyOnTruck: 4, qtyPacked: 4, qtyLeft: 1 })], true)).toBe('station');
  });

  it('is home once anything has been counted back', () => {
    expect(moveOf([line({ qtyPacked: 4, qtyReceived: 4, qtyReturned: 2 })], true)).toBe('home');
  });

  it('the furthest line wins', () => {
    expect(moveOf([line(), line({ qtyOnTruck: 4, qtyPacked: 4, qtyReceived: 4 })], true)).toBe('station');
  });

  it('ignores deleted lines', () => {
    expect(moveOf([line({ qtyOnTruck: 4, deletedAt: '2026-01-02T00:00:00.000Z' })], true)).toBe('plan');
  });
});

describe('moveOf on a direct event', () => {
  it('reads packed as loaded and never says in van', () => {
    expect(moveOf([line({ qtyPacked: 2 })], false)).toBe('truck');
    expect(moveOf([line({ qtyPacked: 4, qtyReceived: 4 })], false)).toBe('station');
  });
});

describe('moveOf with an older list that only has a status', () => {
  it('lands where the status says', () => {
    expect(moveOf([line()], true, 'loaded')).toBe('truck');
    expect(moveOf([line()], false, 'packed')).toBe('truck');
    expect(moveOf([line()], true, 'delivered')).toBe('station');
    expect(moveOf([line()], true, 'reconciled')).toBe('home');
  });
});

describe('countAt and expectedHome', () => {
  it('checks the station in against what was sent, not what was planned', () => {
    expect(countAt(line({ qtyPacked: 3, qtyReceived: 3 }), 'station', true)).toEqual({ got: 3, want: 3 });
    // A list the shed worked on paper never had its lines ticked: the plan stands in.
    expect(sent(line({ qtyRequired: 4, qtyPacked: 0 }))).toBe(4);
    expect(sent(line({ qtyRequired: 4, qtyPacked: 3 }))).toBe(3);
  });

  it('works out what the station used once both counts are in', () => {
    expect(used(line({ qtyReceived: 120, qtyLeft: 14 }))).toBe(106);
    expect(used(line({ qtyReceived: 120 }))).toBeNull();
    expect(used(line({ qtyLeft: 14 }))).toBeNull();
    expect(used(line({ qtyReceived: 10, qtyLeft: 12 }))).toBe(0);
  });

  it('expects home what the station counted, else what arrived, else what was sent', () => {
    expect(expectedHome(line({ qtyPacked: 4, qtyReceived: 3, qtyLeft: 1 }))).toBe(1);
    expect(expectedHome(line({ qtyPacked: 4, qtyReceived: 3 }))).toBe(3);
    expect(expectedHome(line({ qtyPacked: 4 }))).toBe(4);
  });

  it('expects nothing home from an uncounted consumable', () => {
    expect(expectedHome(line({ qtyPacked: 120, qtyReceived: 120 }), true)).toBe(0);
    expect(expectedHome(line({ qtyPacked: 120, qtyLeft: 14 }), true)).toBe(14);
  });
});

describe('moveProgress', () => {
  it('counts complete lines and what is left to go', () => {
    const lines = [line({ qtyOnTruck: 4 }), line({ qtyOnTruck: 1 }), line()];
    expect(moveProgress(lines, 'truck', true)).toEqual({ done: 1, total: 3, percent: 33, short: 2, remaining: 7 });
  });

  it('reads planned lines as done once they exist', () => {
    expect(moveProgress([line(), line()], 'plan', true).percent).toBe(100);
    expect(moveProgress([], 'plan', true).percent).toBe(0);
  });
});

describe('the board', () => {
  it('counts stations per move and leads with the slowest', () => {
    const rows = [{ move: 'truck' as const }, { move: 'vans' as const }, { move: 'truck' as const }];
    expect(boardCounts(rows)).toEqual({ plan: 0, truck: 2, vans: 1, station: 0, home: 0 });
    expect(currentMove(rows, true)).toBe('truck');
  });

  it('is at plan with no stations, and at the last move once every station is there', () => {
    expect(currentMove([], true)).toBe('plan');
    expect(currentMove([{ move: 'home' }], false)).toBe('home');
  });
});
