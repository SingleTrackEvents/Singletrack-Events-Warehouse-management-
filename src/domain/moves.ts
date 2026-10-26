import type { PacklistLine, PacklistStatus } from '../db/types';
import { isConfirmed, received, statusIndex } from './packlists';
import { round2 } from './stock';

/**
 * The five moves a station's list makes: planned, on the truck, in the van,
 * at the station, home.
 *
 * Nobody reports these. They are read off the quantities the crew already
 * write down as the crate goes past them: how many are needed, how many went
 * on the truck, how many into the van, how many arrived, how many came home.
 * A list with everything on the truck is "on truck" whether or not anyone
 * remembered to tap a button, which on race weekend nobody does.
 *
 * An event that loads straight from the shed into each station's vehicle has
 * no van stage, so it makes four moves: the truck move is then the load.
 */
export type Move = 'plan' | 'truck' | 'vans' | 'station' | 'home';

export const MOVES: Move[] = ['plan', 'truck', 'vans', 'station', 'home'];

/** The moves this event makes, in order. */
export function movesFor(truckStage: boolean): Move[] {
  return truckStage ? MOVES : MOVES.filter((move) => move !== 'vans');
}

/** The move as a heading: the stage of the weekend. */
export function moveLabel(move: Move, truckStage: boolean): string {
  switch (move) {
    case 'plan':
      return 'Plan';
    case 'truck':
      return truckStage ? 'Truck' : 'Load';
    case 'vans':
      return 'Vans';
    case 'station':
      return 'Station';
    case 'home':
      return 'Home';
  }
}

/** The move as a state: where one station's gear is right now. */
export function moveState(move: Move, truckStage: boolean): string {
  switch (move) {
    case 'plan':
      return 'planned';
    case 'truck':
      return truckStage ? 'on truck' : 'loaded';
    case 'vans':
      return 'in van';
    case 'station':
      return 'at station';
    case 'home':
      return 'home';
  }
}

export const MOVE_TONE: Record<Move, 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'> = {
  plan: 'default',
  truck: 'accent',
  vans: 'info',
  station: 'ok',
  home: 'warn',
};

export function moveIndex(move: Move): number {
  return MOVES.indexOf(move);
}

/**
 * What the station should expect off the van: what the shed packed, or the
 * requirement when the shed never ticked the line (a list worked on paper).
 */
export function sent(line: PacklistLine): number {
  return line.qtyPacked > 0 ? line.qtyPacked : line.qtyRequired;
}

/** What the station used: arrived less what was left, once both are known. */
export function used(line: PacklistLine): number | null {
  if (!hasLeft(line) || !isConfirmed(line)) return null;
  return round2(Math.max(0, received(line) - (line.qtyLeft as number)));
}

/** True once a line has an end-of-day or pack-down count from the station. */
export function hasLeft(line: PacklistLine): boolean {
  return line.qtyLeft !== undefined && line.qtyLeft !== null;
}

/**
 * Where a station's list is, read from its lines.
 *
 * The furthest move any line has reached wins: once one crate has been
 * checked in at the station, the station is the place to look for the rest.
 * A list's status is read too, so lists worked before the moves existed
 * land where their status says.
 */
export function moveOf(
  lines: PacklistLine[],
  truckStage: boolean,
  status: PacklistStatus = 'draft',
): Move {
  const live = lines.filter((line) => !line.deletedAt);
  const at = statusIndex(status);
  if (at >= statusIndex('returned') || live.some((line) => line.qtyReturned > 0)) return 'home';
  if (at >= statusIndex('delivered') || live.some((line) => isConfirmed(line) || hasLeft(line))) {
    return 'station';
  }
  if (truckStage) {
    if (live.some((line) => line.qtyPacked > 0)) return 'vans';
    if (at >= statusIndex('loaded') || live.some((line) => (line.qtyOnTruck ?? 0) > 0)) return 'truck';
    return 'plan';
  }
  if (at >= statusIndex('packed') || live.some((line) => line.qtyPacked > 0)) return 'truck';
  return 'plan';
}

/**
 * What a line should read at a move, and what it does read.
 *
 * The target for the station is what was sent, not what was planned: a crate
 * the warehouse packed short is checked in against the four that left, so
 * the shortfall shows up once, at the shed, rather than again at the station.
 */
export function countAt(line: PacklistLine, move: Move, truckStage: boolean): { got: number; want: number } {
  // Gear moving on from another station is not the warehouse's to load.
  if (line.fromDestinationId && (move === 'truck' || move === 'vans')) return { got: 1, want: 1 };
  switch (move) {
    case 'plan':
      return { got: line.qtyRequired > 0 ? 1 : 0, want: 1 };
    case 'truck':
      return { got: truckStage ? line.qtyOnTruck ?? 0 : line.qtyPacked, want: line.qtyRequired };
    case 'vans':
      return { got: line.qtyPacked, want: truckStage ? line.qtyOnTruck ?? line.qtyRequired : line.qtyRequired };
    case 'station':
      return { got: received(line), want: sent(line) };
    case 'home':
      return { got: line.qtyReturned, want: expectedHome(line) };
  }
}

/**
 * What should come home from a line.
 *
 * The station's own count when it made one; otherwise what arrived, and
 * failing that what was sent. Consumables with no count are assumed used,
 * which is the safe assumption for the shed: nothing is booked back that
 * nobody saw.
 */
export function expectedHome(line: PacklistLine, consumable = false): number {
  return round2(stationHome(line, consumable) + leftOnTruck(line));
}

/** What should come home from the station itself. */
function stationHome(line: PacklistLine, consumable: boolean): number {
  if (hasLeft(line)) return line.qtyLeft as number;
  if (consumable) return 0;
  if (isConfirmed(line)) return received(line);
  // Gear moving on from another station was never packed here; it was due.
  if (line.fromDestinationId) return line.qtyRequired;
  return line.qtyPacked;
}

/**
 * Gear that left the warehouse on the truck for a station but never went
 * into its van. It is still on the truck, or in the yard, and comes home
 * with the truck: sixty-three tables out and twenty-three in vans is forty
 * that must still be counted in, or the warehouse loses them.
 */
export function leftOnTruck(line: PacklistLine): number {
  return round2(Math.max(0, (line.qtyIssued ?? 0) - line.qtyPacked));
}

export interface MoveProgress {
  /** Lines complete at this move. */
  done: number;
  total: number;
  percent: number;
  /** Lines still short at this move. */
  short: number;
  /** Units still to go at this move. */
  remaining: number;
}

/** How far through a move a list is. */
export function moveProgress(lines: PacklistLine[], move: Move, truckStage: boolean): MoveProgress {
  const live = lines.filter((line) => !line.deletedAt);
  let done = 0;
  let remaining = 0;
  for (const line of live) {
    const { got, want } = countAt(line, move, truckStage);
    if (got >= want) done += 1;
    else remaining += want - got;
  }
  return {
    done,
    total: live.length,
    percent: live.length ? Math.round((done / live.length) * 100) : 0,
    short: live.length - done,
    remaining: round2(remaining),
  };
}

/** One station on the board. */
export interface BoardRow {
  destinationId: string;
  packlistId: string | null;
  move: Move;
  progress: MoveProgress;
  /** Must-have lines still short of their requirement. */
  blocking: number;
  /** How many lists the station has; more than one is a mistake worth seeing. */
  lists: number;
}

/** How many stations sit at each move. */
export function boardCounts(rows: Array<{ move: Move }>): Record<Move, number> {
  const counts: Record<Move, number> = { plan: 0, truck: 0, vans: 0, station: 0, home: 0 };
  for (const row of rows) counts[row.move] += 1;
  return counts;
}

/**
 * The move the event is at: the earliest one any station is still at, since
 * the weekend cannot move on until the slowest crate does.
 */
export function currentMove(rows: Array<{ move: Move }>, truckStage: boolean): Move {
  const moves = movesFor(truckStage);
  for (const move of moves) if (rows.some((row) => row.move === move)) return move;
  return rows.length ? moves[moves.length - 1] : 'plan';
}
