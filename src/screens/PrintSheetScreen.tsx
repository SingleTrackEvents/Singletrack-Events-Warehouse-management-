import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { QrCode } from '../components/QrCode';
import { db } from '../db/db';
import { alive, byId } from '../db/repo';
import { useCategories, useEvent, usePacklist, usePacklistLines } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import { unloadOrder } from '../domain/truck';
import { sent } from '../domain/moves';
import { formatQty } from '../domain/format';
import { stationHours } from '../domain/runSheet';

/**
 * A station's run sheet on paper.
 *
 * The fallback at a station is a printed sheet, and the app's own list has to
 * print as one: the facts a volunteer reads first, then every line in the
 * order it comes off the van, with a box to tick and a column to write what
 * arrived. The QR code opens the same list on a phone that turns up later.
 */
export default function PrintSheetScreen() {
  const { packlistId } = useParams();
  const { session } = useSession();
  const packlist = usePacklist(packlistId);
  const lines = usePacklistLines(packlistId);
  const event = useEvent(packlist?.eventId);
  const categories = useCategories();
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);
  const destination = useLiveQuery(
    async () => (packlist ? db.destinations.get(packlist.destinationId) : undefined),
    [packlist?.destinationId],
  );

  const ordered = useMemo(() => {
    const byCategory = new Map((categories ?? []).map((category) => [category.id, category]));
    return unloadOrder(lines ?? [], (line) => byCategory.get(items?.get(line.itemId)?.categoryId ?? ''));
  }, [lines, items, categories]);

  if (!packlist || !items) {
    return (
      <Screen title="Run sheet" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }
  if (!can(session, 'packlist:read', { eventId: packlist.eventId, destinationId: packlist.destinationId })) {
    return <Navigate to="/" replace />;
  }

  const link = `${location.origin}${location.pathname}#/scan/${encodeURIComponent(packlist.code)}`;
  const hours = destination ? stationHours(destination) : [];
  const facts: Array<[string, string]> = destination
    ? [
        ['Hours', hours.join('; ') || 'Not set'],
        ['Crew lead', [destination.crewLead, destination.phone].filter(Boolean).join(', ') || 'Not set'],
        ['Vehicle', destination.vehicle || 'Not set'],
        ['Power', destination.schedule?.power || ''],
        ['Internet', destination.schedule?.connectivity || ''],
        ['Access', destination.accessNotes || ''],
        ['Set-up', destination.schedule?.setup || ''],
        ['Pack-down', destination.schedule?.packDown || ''],
      ].filter((entry): entry is [string, string] => Boolean(entry[1]))
    : [];

  return (
    <Screen title="Run sheet" subtitle={packlist.name} back={`/packlists/${packlist.id}`}>
      <div className="btn-row mb-3 no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>

      <div className="print-sheet">
        <div className="print-head">
          <div>
            <h1 className="print-title">{destination?.name ?? packlist.name}</h1>
            <div className="small">
              {event?.name} · list {packlist.code}
            </div>
          </div>
          <QrCode value={link} size={96} alt={`QR code for ${packlist.code}`} />
        </div>

        <table className="print-facts">
          <tbody>
            {facts.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="print-lines">
          <thead>
            <tr>
              <th scope="col" aria-label="Ticked" />
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col">Shelf</th>
              <th scope="col">Sent</th>
              <th scope="col">Arrived</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((line, index) => {
              const item = items.get(line.itemId);
              return (
                <tr key={line.id}>
                  <td className="print-box">☐</td>
                  <td>{index + 1}</td>
                  <td>
                    {item?.name ?? 'Unknown item'}
                    {line.mandatory ? ' *' : ''}
                    {line.note ? <div className="tiny">{line.note}</div> : null}
                  </td>
                  <td>{item?.bin || ''}</td>
                  <td className="nowrap">{formatQty(sent(line), item?.unit ?? 'each')}</td>
                  <td className="print-write" />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="tiny mt-3">
          In unload order: what the station needs first is at the top. * must-have. Write what
          arrived, then enter it on the phone when it has signal.
        </p>
      </div>
    </Screen>
  );
}
