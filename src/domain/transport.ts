import { db } from '../db/db';
import { create, liveWhere, nextSort, softDelete, update } from '../db/repo';
import type { Destination, Load, LoadStatus, LoadStop, Packlist } from '../db/types';
import { setStatus } from './packlists';

/**
 * Transport runs.
 *
 * A load is one vehicle doing one trip: a driver, a list of stops in delivery
 * order, and the packlists dropped at each. Marking a stop delivered pushes the
 * packlists at that stop through their own lifecycle, so the warehouse view and
 * the driver's view never disagree.
 */

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  planned: 'Planned',
  loading: 'Loading',
  in_transit: 'On the road',
  delivering: 'Delivering',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

export async function createLoad(
  eventId: string,
  data: Partial<Pick<Load, 'name' | 'vehicle' | 'driver' | 'phone' | 'departAt' | 'notes'>> = {},
): Promise<Load> {
  return create(db.loads, {
    eventId,
    name: data.name?.trim() || 'Run 1',
    vehicle: data.vehicle ?? '',
    driver: data.driver ?? '',
    phone: data.phone ?? '',
    status: 'planned',
    departAt: data.departAt ?? null,
    departedAt: null,
    completedAt: null,
    notes: data.notes ?? '',
  });
}

/** Add a destination to the end of a load's run sheet. */
export async function addStop(loadId: string, destinationId: string): Promise<LoadStop | null> {
  const stops = await liveWhere(db.loadStops, 'loadId', loadId);
  if (stops.some((stop) => stop.destinationId === destinationId)) return null;
  return create(db.loadStops, {
    loadId,
    destinationId,
    sort: nextSort(stops),
    arrivedAt: null,
    signedBy: '',
    notes: '',
  });
}

export async function removeStop(stopId: string): Promise<void> {
  await softDelete(db.loadStops, stopId);
}

/** Move a stop up or down the run sheet. */
export async function moveStop(stops: LoadStop[], stopId: string, direction: -1 | 1): Promise<void> {
  const ordered = [...stops].sort((a, b) => a.sort - b.sort);
  const index = ordered.findIndex((stop) => stop.id === stopId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  const a = ordered[index];
  const b = ordered[target];
  await update(db.loadStops, a.id, { sort: b.sort });
  await update(db.loadStops, b.id, { sort: a.sort });
}

/** Packlists riding on a given stop — every list for that destination. */
export async function packlistsForStop(stop: LoadStop): Promise<Packlist[]> {
  return liveWhere(db.packlists, 'destinationId', stop.destinationId);
}

/**
 * Mark a stop delivered: stamp the signature and push its packlists to
 * `delivered` (issuing stock on the way if they had not been marked loaded).
 */
export async function deliverStop(
  stop: LoadStop,
  options: { signedBy?: string; by?: string; notes?: string } = {},
): Promise<void> {
  const packlists = await packlistsForStop(stop);
  for (const packlist of packlists) {
    await setStatus(packlist, 'delivered', { by: options.by, receivedBy: options.signedBy });
  }
  await update(db.loadStops, stop.id, {
    arrivedAt: stop.arrivedAt ?? new Date().toISOString(),
    signedBy: options.signedBy ?? stop.signedBy,
    notes: options.notes ?? stop.notes,
  });
}

/** Depart the warehouse: everything on board is issued out of stock. */
export async function departLoad(load: Load, by = ''): Promise<void> {
  const stops = await liveWhere(db.loadStops, 'loadId', load.id);
  for (const stop of stops) {
    const packlists = await packlistsForStop(stop);
    for (const packlist of packlists) {
      await setStatus(packlist, 'loaded', { by });
    }
  }
  await update(db.loads, load.id, {
    status: 'in_transit',
    departedAt: new Date().toISOString(),
  });
}

export async function completeLoad(loadId: string): Promise<void> {
  await update(db.loads, loadId, {
    status: 'complete',
    completedAt: new Date().toISOString(),
  });
}

export interface LoadProgress {
  stops: number;
  delivered: number;
  percent: number;
  nextStop: LoadStop | null;
}

export function loadProgress(stops: LoadStop[]): LoadProgress {
  const ordered = [...stops.filter((stop) => !stop.deletedAt)].sort((a, b) => a.sort - b.sort);
  const delivered = ordered.filter((stop) => stop.arrivedAt);
  return {
    stops: ordered.length,
    delivered: delivered.length,
    percent: ordered.length ? Math.round((delivered.length / ordered.length) * 100) : 0,
    nextStop: ordered.find((stop) => !stop.arrivedAt) ?? null,
  };
}

/** Destinations for an event that no load is calling at yet. */
export function unassignedDestinations(
  destinations: Destination[],
  stops: LoadStop[],
): Destination[] {
  const covered = new Set(stops.filter((stop) => !stop.deletedAt).map((stop) => stop.destinationId));
  return destinations.filter((destination) => !covered.has(destination.id));
}
