import { db } from '../db/db';
import { alive, update } from '../db/repo';
import type { Destination, StationSchedule } from '../db/types';

/**
 * Individual units: Starlink 1 to 5, the Minis, EcoFlow #1 to #5, the light
 * towers and generators.
 *
 * The packlists count these, but over a race weekend each one moves from
 * station to station, and "where is Starlink 3" needs a name, not a number.
 * A unit lives on the station it is at, in the station's schedule. Moving
 * it is taking it off one station and putting it on another.
 */

export interface UnitPlace {
  unit: string;
  /** The stations that list this unit. More than one is a clash worth seeing. */
  at: Destination[];
}

const emptySchedule = (): StationSchedule => ({
  windows: [],
  departsAt: null,
  setup: '',
  packDown: '',
  power: '',
  connectivity: '',
});

/** Unit names in a sensible order: Starlink 2 before Starlink 10. */
export function compareUnits(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Every unit named on an event's stations, with where it is. */
export function unitPlaces(destinations: Destination[]): UnitPlace[] {
  const places = new Map<string, UnitPlace>();
  for (const destination of destinations) {
    for (const raw of destination.schedule?.units ?? []) {
      const unit = raw.trim();
      if (!unit) continue;
      const key = unit.toLowerCase();
      const place = places.get(key) ?? { unit, at: [] };
      place.at.push(destination);
      places.set(key, place);
    }
  }
  return [...places.values()].sort((a, b) => compareUnits(a.unit, b.unit));
}

/**
 * Move a unit to a station, or off every station with `to` null. It comes
 * off wherever it was, so a unit is only ever in one place.
 */
export async function moveUnit(eventId: string, unit: string, to: string | null): Promise<void> {
  const key = unit.trim().toLowerCase();
  const destinations = alive(await db.destinations.where('eventId').equals(eventId).toArray());
  // Keep the spelling the unit already has, so "starlink 3" moves Starlink 3.
  const name =
    destinations
      .flatMap((destination) => destination.schedule?.units ?? [])
      .find((entry) => entry.trim().toLowerCase() === key)
      ?.trim() ?? unit.trim();
  for (const destination of destinations) {
    const units = destination.schedule?.units ?? [];
    const has = units.some((entry) => entry.trim().toLowerCase() === key);
    const wanted = destination.id === to;
    if (has === wanted) continue;
    const next = wanted ? [...units, name] : units.filter((entry) => entry.trim().toLowerCase() !== key);
    await update(db.destinations, destination.id, {
      schedule: { ...(destination.schedule ?? emptySchedule()), units: next.sort(compareUnits) },
    });
  }
}
