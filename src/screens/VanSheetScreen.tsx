import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState } from '../components/ui';
import { db } from '../db/db';
import { alive, byId } from '../db/repo';
import { useCategories, useDestinations, useEvent } from '../hooks/useDb';
import { primaryPacklist } from '../domain/packlists';
import { unloadOrder } from '../domain/truck';
import { formatQty, plural } from '../domain/format';
import { formatLocalWhen } from '../domain/runSheet';
import { sheetLine, sheetSummary, summaryText, vanGroups } from '../domain/printSheet';
import type { SheetLine } from '../domain/printSheet';
import type { Item, PacklistLine } from '../db/types';

/**
 * One printed sheet per vehicle, for the yard.
 *
 * Whoever loads a van wants one piece of paper for it: the stations it
 * serves, and for each one what is packed and what is not. Sheets come in
 * the order the vans leave, so the pile on the clipboard is the morning in
 * order. Each vehicle starts a new page, and anything short says MISSING so
 * nobody drives off thinking it is in the back.
 */
export default function VanSheetScreen() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const destinations = useDestinations(eventId);
  const categories = useCategories();
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);

  // Every list for the event and its items, read once for every vehicle.
  const lists = useLiveQuery(async () => {
    if (!eventId) return undefined;
    const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
    const ids = packlists.map((packlist) => packlist.id);
    const lines = alive(await db.packlistLines.where('packlistId').anyOf(ids).toArray());
    const linesByList = new Map<string, PacklistLine[]>();
    for (const line of lines) {
      const bucket = linesByList.get(line.packlistId) ?? [];
      bucket.push(line);
      linesByList.set(line.packlistId, bucket);
    }
    return { packlists, linesByList };
  }, [eventId]);

  const groups = useMemo(() => {
    if (!destinations || !lists) return undefined;
    const count = (id: string) => lists.linesByList.get(id)?.length ?? 0;
    return vanGroups(destinations, (destination) =>
      primaryPacklist(
        lists.packlists.filter((packlist) => packlist.destinationId === destination.id),
        (packlist) => count(packlist.id),
      ),
    );
  }, [destinations, lists]);

  if (!event || !groups || !items || !lists) {
    return (
      <Screen title="Van sheets" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const byCategory = new Map((categories ?? []).map((category) => [category.id, category]));
  const linesFor = (packlistId: string | undefined): SheetLine[] =>
    unloadOrder(packlistId ? lists.linesByList.get(packlistId) ?? [] : [], (line) =>
      byCategory.get(items.get(line.itemId)?.categoryId ?? ''),
    ).map(sheetLine);
  const nameOf = (line: PacklistLine) => items.get(line.itemId)?.name ?? 'Unknown item';
  const stationName = (id: string) => destinations?.find((entry) => entry.id === id)?.name ?? 'another station';

  return (
    <Screen title="Van sheets" subtitle={event.name} back="-1">
      {groups.length ? (
        <div className="row-flex wrap mb-3 no-print">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            🖨 Print
          </button>
          <span className="small muted">
            {plural(groups.length, 'sheet')}, one per vehicle, in the order they leave.
          </span>
        </div>
      ) : (
        <EmptyState glyph="🚐" title="No stations yet" body="Add stations to the event and their vans show here." />
      )}

      {groups.map((group) => {
        const summary = sheetSummary(
          group.stations.flatMap((station) => linesFor(station.packlist?.id)),
          nameOf,
        );
        const departs = group.stations
          .map((station) => station.destination.schedule?.departsAt)
          .find(Boolean);
        return (
          <section key={group.vehicle ?? 'none'} className="print-sheet print-page mb-4">
            <div className="print-head">
              <div>
                <h1 className="print-title">{group.vehicle ?? 'No vehicle yet'}</h1>
                <div className="small">
                  {event.name}
                  {departs ? ` · leaves ${formatLocalWhen(departs)}` : ''}
                </div>
              </div>
            </div>
            <p className="small mb-2">
              <span className="strong">Stations: </span>
              {group.stations.map((station) => station.destination.name).join(', ')}
            </p>
            <p className={`print-summary ${summary.missing.length ? 'short' : 'done'}`}>{summaryText(summary)}</p>

            {group.stations.map((station) => {
              const lines = linesFor(station.packlist?.id);
              return (
                <div key={station.destination.id} className="print-station">
                  <h2 className="print-station-name">{station.destination.name}</h2>
                  {lines.length ? (
                    <StationTable lines={lines} items={items} stationName={stationName} />
                  ) : (
                    <p className="small muted">No list for this station yet.</p>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      {groups.length ? (
        <p className="tiny mt-3">
          Each station's items are in unload order. A ticked box was packed in full. MISSING means it
          never went in, so do not look for it in the van.
        </p>
      ) : null}
    </Screen>
  );
}

function StationTable({
  lines,
  items,
  stationName,
}: {
  lines: SheetLine[];
  items: Map<string, Item>;
  stationName: (id: string) => string;
}) {
  return (
    <div className="print-scroll">
    <table className="print-lines">
      <thead>
        <tr>
          <th scope="col" aria-label="Ticked" />
          <th scope="col">Item</th>
          <th scope="col">Shelf</th>
          <th scope="col">Needed</th>
          <th scope="col">Packed</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((entry) => {
          const item = items.get(entry.line.itemId);
          const unit = item?.unit ?? 'each';
          return (
            <tr key={entry.line.id} className={entry.missing ? 'print-short' : undefined}>
              <td className="print-box">{entry.done ? '☑' : '☐'}</td>
              <td>
                {item?.name ?? 'Unknown item'}
                {entry.line.mandatory ? ' *' : ''}
              </td>
              <td>{item?.bin || ''}</td>
              <td className="nowrap">{formatQty(entry.needed, unit)}</td>
              {entry.fromStationId ? (
                <td>Comes from {stationName(entry.fromStationId)}</td>
              ) : (
                <td className="nowrap">
                  {formatQty(entry.packed, unit)}
                  {entry.missing ? (
                    <div className="print-missing">MISSING {formatQty(entry.missing, unit)}</div>
                  ) : null}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
