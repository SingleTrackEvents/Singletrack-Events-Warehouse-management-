import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, getSettings } from '../db/db';
import { alive, sortBySort } from '../db/repo';
import type {
  Category,
  ConsumptionLine,
  Destination,
  Item,
  Packlist,
  PacklistLine,
  Race,
  RaceEvent,
  Settings,
  SyncMeta,
} from '../db/types';

/**
 * Live queries.
 *
 * Everything reads through Dexie's `useLiveQuery`, so any write anywhere in the
 * app re-renders the screens showing that data. No manual refresh, which matters
 * when two crew are working the same packlist on one tablet.
 */

/** All live (non-tombstoned) rows of a table, re-running on any change. */
export function useAlive<T extends SyncMeta>(
  query: () => Promise<T[]>,
  deps: unknown[] = [],
): T[] | undefined {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useLiveQuery(query, deps);
  return useMemo(() => (rows ? alive(rows) : undefined), [rows]);
}

export function useItems(): Item[] | undefined {
  const rows = useLiveQuery(() => db.items.toArray(), []);
  return useMemo(
    () =>
      rows
        ? alive(rows).sort((a, b) => a.name.localeCompare(b.name))
        : undefined,
    [rows],
  );
}

export function useItem(id: string | undefined): Item | undefined {
  return useLiveQuery(() => (id ? db.items.get(id) : undefined), [id]);
}

export function useCategories(): Category[] | undefined {
  const rows = useLiveQuery(() => db.categories.toArray(), []);
  return useMemo(() => (rows ? sortBySort(alive(rows)) : undefined), [rows]);
}

export function useEvents(): RaceEvent[] | undefined {
  const rows = useLiveQuery(() => db.events.toArray(), []);
  return useMemo(
    () => (rows ? alive(rows).sort((a, b) => a.startDate.localeCompare(b.startDate)) : undefined),
    [rows],
  );
}

export function useEvent(id: string | undefined): RaceEvent | undefined {
  return useLiveQuery(() => (id ? db.events.get(id) : undefined), [id]);
}

export function useDestinations(eventId: string | undefined): Destination[] | undefined {
  const rows = useLiveQuery(
    () =>
      eventId
        ? db.destinations.where('eventId').equals(eventId).toArray()
        : Promise.resolve<Destination[]>([]),
    [eventId],
  );
  return useMemo(() => (rows ? sortBySort(alive(rows)) : undefined), [rows]);
}

export function usePacklists(eventId: string | undefined): Packlist[] | undefined {
  const rows = useLiveQuery(
    () => (eventId ? db.packlists.where('eventId').equals(eventId).toArray() : db.packlists.toArray()),
    [eventId],
  );
  return useMemo(() => (rows ? alive(rows) : undefined), [rows]);
}

export function usePacklist(id: string | undefined): Packlist | undefined {
  return useLiveQuery(() => (id ? db.packlists.get(id) : undefined), [id]);
}

export function usePacklistLines(packlistId: string | undefined): PacklistLine[] | undefined {
  const rows = useLiveQuery(
    () =>
      packlistId
        ? db.packlistLines.where('packlistId').equals(packlistId).toArray()
        : Promise.resolve<PacklistLine[]>([]),
    [packlistId],
  );
  return useMemo(() => (rows ? sortBySort(alive(rows)) : undefined), [rows]);
}

export function useRaces(eventId: string | undefined): Race[] | undefined {
  const rows = useLiveQuery(
    () =>
      eventId ? db.races.where('eventId').equals(eventId).toArray() : Promise.resolve<Race[]>([]),
    [eventId],
  );
  return useMemo(() => (rows ? sortBySort(alive(rows)) : undefined), [rows]);
}

export function useConsumptionLines(eventId: string | undefined): ConsumptionLine[] | undefined {
  const rows = useLiveQuery(
    () =>
      eventId
        ? db.consumptionLines.where('eventId').equals(eventId).toArray()
        : Promise.resolve<ConsumptionLine[]>([]),
    [eventId],
  );
  return useMemo(() => (rows ? sortBySort(alive(rows)) : undefined), [rows]);
}

/** The settings singleton, created on first read. */
export function useSettings(): Settings | undefined {
  const [fallback, setFallback] = useState<Settings>();
  const rows = useLiveQuery(() => db.settings.toArray(), []);

  useEffect(() => {
    if (rows && rows.length === 0) void getSettings().then(setFallback);
  }, [rows]);

  return rows?.[0] ?? fallback;
}

/** Crew name stamped onto movements from this device. */
export function useCrewName(): string {
  return useSettings()?.crewName ?? '';
}
