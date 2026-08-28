import { db } from '../db/db';
import { alive, create, liveWhere, nextSort, update } from '../db/repo';
import type { ConsumptionLine, Destination, Item, Race } from '../db/types';
import { createPacklist } from './packlists';
import { round2 } from './stock';

/**
 * Food consumption planning.
 *
 * The plan mirrors how the spreadsheet it replaces worked: each race carries a
 * projected field size, each aid station names the races passing through it,
 * and each item at a station has a per-runner ratio. Quantities are derived,
 * never typed — change a projection and every station feeding that race moves
 * with it. The derived quantities then feed each aid station's packlist, which
 * is where picking, packing and stock movements already live.
 */

/**
 * Expected runners through a destination: each linked race's projection times
 * how many times its course passes the site. A race that has been deleted, or
 * a stale link left by an undone edit, counts for nothing rather than nothing
 * rendering.
 */
export function stationRunners(destination: Destination, races: Race[]): number {
  const byId = new Map(races.filter((race) => !race.deletedAt).map((race) => [race.id, race]));
  return (destination.raceVisits ?? []).reduce((sum, visit) => {
    const race = byId.get(visit.raceId);
    return race ? sum + race.projection * Math.max(1, Math.round(visit.passes)) : sum;
  }, 0);
}

/**
 * Quantity a line calls for at a station.
 *
 * The per-runner part rounds up — 6.7 packs of electrolyte is 7 on the truck —
 * but only after settling floating point, so 0.2 × 430 reads as 86 cans and
 * not 87. The flat part rides on top unscaled.
 */
export function lineQty(line: ConsumptionLine, runners: number): number {
  const scaled = line.perRunner > 0 ? Math.ceil(round2(line.perRunner * Math.max(0, runners))) : 0;
  return scaled + Math.max(0, line.flatQty);
}

/** One item's demand across the whole event, against what the warehouse holds. */
export interface FoodTotal {
  item: Item;
  /** Sum of every station's computed quantity, in the item's unit. */
  total: number;
  onHand: number;
  /** What still has to be bought: demand not covered by stock. */
  toOrder: number;
}

/**
 * The shopping list: every planned item summed across stations and compared to
 * stock on hand. Sorted with the shortfalls first, because that is the part
 * someone is about to take to a supplier.
 */
export function totalsToOrder(
  lines: ConsumptionLine[],
  runnersByDestination: Map<string, number>,
  items: Item[],
): FoodTotal[] {
  const demand = new Map<string, number>();
  for (const line of lines) {
    if (line.deletedAt) continue;
    const runners = runnersByDestination.get(line.destinationId) ?? 0;
    const qty = lineQty(line, runners);
    if (qty <= 0) continue;
    demand.set(line.itemId, (demand.get(line.itemId) ?? 0) + qty);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const totals: FoodTotal[] = [];
  for (const [itemId, total] of demand) {
    const item = byId.get(itemId);
    if (!item) continue;
    totals.push({
      item,
      total: round2(total),
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
  /** destination id → expected runners through it. */
  runners: Map<string, number>;
}

export async function loadFoodPlan(eventId: string, destinations: Destination[]): Promise<FoodPlan> {
  const [races, lines] = await Promise.all([
    liveWhere(db.races, 'eventId', eventId),
    liveWhere(db.consumptionLines, 'eventId', eventId),
  ]);
  const runners = new Map(
    destinations.map((destination) => [destination.id, stationRunners(destination, races)]),
  );
  return { races, lines, runners };
}

/**
 * Add items to a station's plan, skipping any already on it. New lines start
 * with the picked quantity as the flat amount — the ratio is a deliberate
 * second step, because a sensible per-runner figure is not something a picker
 * stepper can express.
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
    });
    sort += 10;
    added += 1;
  }
  return added;
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
 * many times the button is hit. Lines the crew added by hand for items outside
 * the plan are never touched, and a plan line computing to zero leaves the
 * packlist alone rather than quietly blanking a quantity someone typed.
 */
export async function applyPlanToPacklists(
  eventId: string,
  destinations: Destination[],
): Promise<ApplyResult> {
  const plan = await loadFoodPlan(eventId, destinations);
  const result: ApplyResult = { stations: 0, created: 0, lines: 0 };

  for (const destination of destinations) {
    const planLines = plan.lines.filter((line) => line.destinationId === destination.id);
    const runners = plan.runners.get(destination.id) ?? 0;
    const wanted = planLines
      .map((line) => ({ itemId: line.itemId, qty: lineQty(line, runners) }))
      .filter((line) => line.qty > 0);
    if (!wanted.length) continue;

    let packlist = alive(
      await db.packlists.where('destinationId').equals(destination.id).toArray(),
    )[0];
    if (!packlist) {
      packlist = await createPacklist(destination);
      result.created += 1;
    }

    const existing = await liveWhere(db.packlistLines, 'packlistId', packlist.id);
    const byItem = new Map(existing.map((line) => [line.itemId, line]));
    let sort = nextSort(existing);
    let touched = 0;

    for (const line of wanted) {
      const match = byItem.get(line.itemId);
      if (match) {
        if (match.qtyRequired !== line.qty) {
          await update(db.packlistLines, match.id, { qtyRequired: line.qty });
          touched += 1;
        }
      } else {
        await create(db.packlistLines, {
          packlistId: packlist.id,
          itemId: line.itemId,
          qtyRequired: line.qty,
          qtyPacked: 0,
          qtyReturned: 0,
          mandatory: false,
          containerId: null,
          note: '',
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
