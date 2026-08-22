import { db } from '../db/db';
import { alive, softDelete, softDeleteChildren } from '../db/repo';

/**
 * Removing an event or a transport run.
 *
 * Everything is tombstoned rather than destroyed, so the removal replicates to
 * the other phones instead of quietly reappearing on the next sync.
 *
 * Stock movements are deliberately left alone. The ledger is the record of what
 * physically left the warehouse; deleting a race a week later must not rewrite
 * the history of where the gear went, or the counts stop adding up.
 */

export interface RemovalSummary {
  destinations: number;
  packlists: number;
  loads: number;
}

/** What removing this event would take with it, without changing anything. */
export async function describeEventRemoval(eventId: string): Promise<RemovalSummary> {
  const [destinations, packlists, loads] = await Promise.all([
    db.destinations.where('eventId').equals(eventId).toArray(),
    db.packlists.where('eventId').equals(eventId).toArray(),
    db.loads.where('eventId').equals(eventId).toArray(),
  ]);
  return {
    destinations: alive(destinations).length,
    packlists: alive(packlists).length,
    loads: alive(loads).length,
  };
}

/** Remove an event and everything belonging to it. */
export async function removeEvent(eventId: string): Promise<RemovalSummary> {
  const summary = await describeEventRemoval(eventId);

  const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
  for (const packlist of packlists) {
    await softDeleteChildren(db.packlistLines, 'packlistId', packlist.id);
    await softDeleteChildren(db.containers, 'packlistId', packlist.id);
    await softDelete(db.packlists, packlist.id);
  }

  const loads = alive(await db.loads.where('eventId').equals(eventId).toArray());
  for (const load of loads) {
    await softDeleteChildren(db.loadStops, 'loadId', load.id);
    await softDelete(db.loads, load.id);
  }

  await softDeleteChildren(db.destinations, 'eventId', eventId);
  await softDelete(db.events, eventId);
  return summary;
}

/** Remove a transport run and its stops. The packlists it carried survive. */
export async function removeLoad(loadId: string): Promise<void> {
  await softDeleteChildren(db.loadStops, 'loadId', loadId);
  await softDelete(db.loads, loadId);
}
