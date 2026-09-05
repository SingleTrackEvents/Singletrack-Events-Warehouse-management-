import { db } from '../db/db';
import { create, liveWhere, nextSort, update } from '../db/repo';
import type { ConsumptionLine, Destination, Item, Race, RaceEvent } from '../db/types';
import { createPacklist, packlistForDestination } from './packlists';
import { round2 } from './stock';

/**
 * Food consumption planning.
 *
 * The plan mirrors how the spreadsheet it replaces worked: each race carries a
 * projected field size and the day it runs, each aid station names the races
 * passing through it, and each rule at a station says how much of one item
 * one runner eats — for every race through the station, or for one race in
 * particular, because a marathon field and a 17k field do not eat alike at
 * the same table. Quantities are derived, never typed, and fall out per day
 * as soon as the races carry dates. The derived quantities then feed each
 * station's packlist, which is where picking, packing and stock movements
 * already live.
 */

/** One race's passage through a station, with the runners it brings. */
export interface StationVisit {
  race: Race;
  passes: number;
  /** projection × passes: every pass eats. */
  runners: number;
  day: string | null;
}

/**
 * The races through a destination. A race that has been deleted, or a stale
 * link left by an undone edit, counts for nothing rather than nothing
 * rendering.
 */
export function stationVisits(destination: Destination, races: Race[]): StationVisit[] {
  const byId = new Map(races.filter((race) => !race.deletedAt).map((race) => [race.id, race]));
  const visits: StationVisit[] = [];
  for (const visit of destination.raceVisits ?? []) {
    const race = byId.get(visit.raceId);
    if (!race) continue;
    const passes = Math.max(1, Math.round(visit.passes));
    visits.push({ race, passes, runners: race.projection * passes, day: race.day ?? null });
  }
  return visits;
}

/** Expected runners through a destination across the whole event. */
export function stationRunners(destination: Destination, races: Race[]): number {
  return stationVisits(destination, races).reduce((sum, visit) => sum + visit.runners, 0);
}

/**
 * Days in the order they fall, with the undated bucket last. Dates are ISO so
 * string order is date order.
 */
export function sortDays(days: Iterable<string | null>): Array<string | null> {
  const set = new Set(days);
  return [...set].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
}

/** Runners through a destination per day, undated races together at the end. */
export function stationRunnersByDay(
  destination: Destination,
  races: Race[],
): Array<[day: string | null, runners: number]> {
  const totals = new Map<string | null, number>();
  for (const visit of stationVisits(destination, races)) {
    totals.set(visit.day, (totals.get(visit.day) ?? 0) + visit.runners);
  }
  return sortDays(totals.keys()).map((day) => [day, totals.get(day) ?? 0]);
}

/**
 * Quantity a rule calls for against a number of runners.
 *
 * The per-runner part rounds up — 6.7 packs of electrolyte is 7 on the truck —
 * but only after settling floating point, so 0.2 × 430 reads as 86 cans and
 * not 87. The flat part rides on top unscaled.
 */
export function lineQty(line: ConsumptionLine, runners: number): number {
  const scaled = line.perRunner > 0 ? Math.ceil(round2(line.perRunner * Math.max(0, runners))) : 0;
  return scaled + Math.max(0, line.flatQty);
}

/**
 * What a rule calls for on each day the station runs.
 *
 * A rule for one race lands on that race's day. A rule for every race is
 * rounded up day by day — each day is packed separately, so each day's
 * part-pack has to be bought — with the flat amount on the first day, since
 * one salt shaker serves the weekend. A station with no races at all still
 * gets its flat amounts, on an undated line.
 */
export function lineQtyByDay(
  line: ConsumptionLine,
  destination: Destination,
  races: Race[],
): Array<[day: string | null, qty: number]> {
  const visits = stationVisits(destination, races);

  if (line.raceId) {
    const visit = visits.find((entry) => entry.race.id === line.raceId);
    if (!visit) return [];
    const qty = lineQty(line, visit.runners);
    return qty > 0 ? [[visit.day, qty]] : [];
  }

  const runnersByDay = stationRunnersByDay(destination, races);
  if (!runnersByDay.length) {
    return line.flatQty > 0 ? [[null, line.flatQty]] : [];
  }
  const out: Array<[string | null, number]> = [];
  runnersByDay.forEach(([day, runners], index) => {
    const qty = lineQty({ ...line, flatQty: index === 0 ? line.flatQty : 0 }, runners);
    if (qty > 0) out.push([day, qty]);
  });
  return out;
}

/** Everything a rule calls for at its station, all days together. */
export function lineTotal(line: ConsumptionLine, destination: Destination, races: Race[]): number {
  return lineQtyByDay(line, destination, races).reduce((sum, [, qty]) => sum + qty, 0);
}

/** "Sat 12 Sep", or "Any day" for the undated bucket. */
export function dayLabel(day: string | null): string {
  if (!day) return 'Any day';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Just the weekday, for tight spaces: "Sat". */
export function dayShort(day: string | null): string {
  if (!day) return 'Any';
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('en-AU', { weekday: 'short' });
}

/** Every date the event covers, for picking which day a race runs. */
export function eventDays(event: Pick<RaceEvent, 'startDate' | 'endDate'>): string[] {
  const days: string[] = [];
  const cursor = new Date(`${event.startDate}T00:00:00Z`);
  const end = new Date(`${event.endDate || event.startDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return days;
  for (let step = 0; cursor <= end && step < 14; step += 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** One item's demand across the whole event, against what the warehouse holds. */
export interface FoodTotal {
  item: Item;
  /** Sum of every station's computed quantity, in the item's unit. */
  total: number;
  /** The same, day by day. */
  byDay: Array<[day: string | null, qty: number]>;
  onHand: number;
  /** What still has to be bought: demand not covered by stock. */
  toOrder: number;
}

/**
 * The shopping list: every planned item summed across stations and days, and
 * compared to stock on hand. Sorted with the shortfalls first, because that is
 * the part someone is about to take to a supplier.
 */
export function totalsToOrder(
  lines: ConsumptionLine[],
  destinations: Destination[],
  races: Race[],
  items: Item[],
): FoodTotal[] {
  const byDestination = new Map(destinations.map((destination) => [destination.id, destination]));
  const demand = new Map<string, Map<string | null, number>>();
  for (const line of lines) {
    if (line.deletedAt) continue;
    const destination = byDestination.get(line.destinationId);
    if (!destination) continue;
    for (const [day, qty] of lineQtyByDay(line, destination, races)) {
      const days = demand.get(line.itemId) ?? new Map<string | null, number>();
      days.set(day, (days.get(day) ?? 0) + qty);
      demand.set(line.itemId, days);
    }
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const totals: FoodTotal[] = [];
  for (const [itemId, days] of demand) {
    const item = byId.get(itemId);
    if (!item) continue;
    const byDay = sortDays(days.keys()).map(
      (day): [string | null, number] => [day, round2(days.get(day) ?? 0)],
    );
    const total = round2(byDay.reduce((sum, [, qty]) => sum + qty, 0));
    if (total <= 0) continue;
    totals.push({
      item,
      total,
      byDay,
      onHand: item.qtyOnHand,
      toOrder: Math.max(0, round2(total - item.qtyOnHand)),
    });
  }
  return totals.sort(
    (a, b) => b.toOrder - a.toOrder || a.item.name.localeCompare(b.item.name),
  );
}

/** Everything the plan needs, read in one go. */
export interface FoodPlan {
  races: Race[];
  lines: ConsumptionLine[];
}

export async function loadFoodPlan(eventId: string): Promise<FoodPlan> {
  const [races, lines] = await Promise.all([
    liveWhere(db.races, 'eventId', eventId),
    liveWhere(db.consumptionLines, 'eventId', eventId),
  ]);
  return { races, lines };
}

/**
 * Add items to a station's plan as rules for every race, skipping any item
 * that already has a rule there. New lines start with the picked quantity as
 * the flat amount — the ratio is a deliberate second step, because a sensible
 * per-runner figure is not something a picker stepper can express.
 */
export async function addPlanItems(
  eventId: string,
  destinationId: string,
  picks: Array<{ itemId: string; qty: number }>,
): Promise<number> {
  const existing = await liveWhere(db.consumptionLines, 'destinationId', destinationId);
  const have = new Set(existing.map((line) => line.itemId));
  let sort = nextSort(existing);
  let added = 0;
  for (const pick of picks) {
    if (have.has(pick.itemId)) continue;
    await create(db.consumptionLines, {
      eventId,
      destinationId,
      itemId: pick.itemId,
      perRunner: 0,
      flatQty: pick.qty,
      note: '',
      sort,
      raceId: null,
    });
    sort += 10;
    added += 1;
  }
  return added;
}

/**
 * A second rule for the same item at the same station, for another race.
 * The copy keeps the ratio as a starting point; the flat amount stays with the
 * original so a shaker is not doubled.
 */
export async function copyRuleForRace(
  line: ConsumptionLine,
  raceId: string | null,
): Promise<ConsumptionLine> {
  const existing = await liveWhere(db.consumptionLines, 'destinationId', line.destinationId);
  return create(db.consumptionLines, {
    eventId: line.eventId,
    destinationId: line.destinationId,
    itemId: line.itemId,
    perRunner: line.perRunner,
    flatQty: 0,
    note: '',
    sort: nextSort(existing),
    raceId,
  });
}

/** The note the plan writes onto a packlist line, so it can recognise its own. */
const NOTE_PREFIX = 'Food plan:';

function planNote(byDay: Array<[string | null, number]>): string {
  if (byDay.length < 2) return '';
  return `${NOTE_PREFIX} ${byDay.map(([day, qty]) => `${dayShort(day)} ${qty}`).join(' · ')}`;
}

export interface ApplyResult {
  /** Stations whose packlist was touched. */
  stations: number;
  /** Packlists created because the station had none yet. */
  created: number;
  /** Lines written — added to a packlist or moved to the plan's quantity. */
  lines: number;
}

/**
 * Push the plan's computed quantities onto each station's packlist.
 *
 * Sets rather than adds, so running it again after a projection moves is safe:
 * a planned item's required quantity always lands on today's number, however
 * many times the button is hit. Several rules for one item — one per race —
 * add up to one packlist line, with the day split written into its note so
 * the station can see how much is Saturday's and how much Sunday's. Lines the
 * crew added by hand for items outside the plan are never touched, nor are
 * notes the crew wrote, and a plan line computing to zero leaves the packlist
 * alone rather than quietly blanking a quantity someone typed.
 */
export async function applyPlanToPacklists(
  eventId: string,
  destinations: Destination[],
): Promise<ApplyResult> {
  const plan = await loadFoodPlan(eventId);
  const result: ApplyResult = { stations: 0, created: 0, lines: 0 };

  for (const destination of destinations) {
    const planLines = plan.lines.filter((line) => line.destinationId === destination.id);
    // Per item: total across rules, and the day split for the note.
    const wanted = new Map<string, Map<string | null, number>>();
    for (const line of planLines) {
      for (const [day, qty] of lineQtyByDay(line, destination, plan.races)) {
        const days = wanted.get(line.itemId) ?? new Map<string | null, number>();
        days.set(day, (days.get(day) ?? 0) + qty);
        wanted.set(line.itemId, days);
      }
    }
    if (!wanted.size) continue;

    let packlist = await packlistForDestination(destination.id);
    if (!packlist) {
      packlist = await createPacklist(destination);
      result.created += 1;
    }

    const existing = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    const byItem = new Map(existing.map((line) => [line.itemId, line]));
    let sort = nextSort(existing);
    let touched = 0;

    for (const [itemId, days] of wanted) {
      const byDay = sortDays(days.keys()).map(
        (day): [string | null, number] => [day, days.get(day) ?? 0],
      );
      const qty = byDay.reduce((sum, [, amount]) => sum + amount, 0);
      if (qty <= 0) continue;
      const note = planNote(byDay);
      const match = byItem.get(itemId);
      if (match) {
        const keepNote = match.note && !match.note.startsWith(NOTE_PREFIX);
        const changes: Partial<typeof match> = {};
        if (match.qtyRequired !== qty) changes.qtyRequired = qty;
        if (!keepNote && match.note !== note) changes.note = note;
        if (Object.keys(changes).length) {
          await update(db.packlistLines, match.id, changes);
          touched += 1;
        }
      } else {
        await create(db.packlistLines, {
          packlistId: packlist.id,
          itemId,
          qtyRequired: qty,
          qtyPacked: 0,
          qtyReturned: 0,
          mandatory: false,
          containerId: null,
          note,
          sort,
        });
        sort += 10;
        touched += 1;
      }
    }

    result.stations += 1;
    result.lines += touched;
  }

  return result;
}
