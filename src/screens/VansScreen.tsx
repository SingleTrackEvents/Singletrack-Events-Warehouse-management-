import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState, Pill, ProgressBar } from '../components/ui';
import { useEvent } from '../hooks/useDb';
import { remainderFor } from '../domain/truck';
import { formatQty, plural } from '../domain/format';

/**
 * The truck emptying into the vans.
 *
 * Each station's list is its van pack; this is the other side of it, the
 * truck. Everything still on it once the vans start taking from it is
 * either a station's share they have not packed yet, or spare. An empty
 * remainder with every van done is the truck being empty, which is the
 * check somebody otherwise does by standing in the back of it.
 */
export default function VansScreen() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const remainder = useLiveQuery(async () => (eventId ? remainderFor(eventId) : undefined), [eventId]);

  if (!event || !remainder) {
    return (
      <Screen title="Vans" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const onTruck = remainder.lines.filter((line) => line.remaining > 0);
  const waiting = onTruck.filter((line) => line.short.length);
  const vansDone = remainder.vans.filter((van) => van.linesTotal > 0 && van.linesDone === van.linesTotal).length;
  const unitsLeft = onTruck.reduce((sum, line) => sum + line.remaining, 0);

  if (!remainder.lines.length) {
    return (
      <Screen title="Vans" subtitle={event.name} back={`/events/${event.id}`}>
        <EmptyState
          glyph="🚛"
          title="Nothing on the truck yet"
          body="Tick gear onto the truck on the warehouse list. Once the vans start taking from it, what is left shows here."
          action={
            <Link className="btn btn-primary" to={`/events/${event.id}/warehouse`}>
              Warehouse list
            </Link>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title="Vans" subtitle={event.name} back={`/events/${event.id}`}>
      <div className="card card-pad mb-3">
        <div className="spread mb-2">
          <span className="strong">
            {vansDone} of {plural(remainder.vans.length, 'van')} packed
          </span>
          {onTruck.length ? (
            <Pill tone={waiting.length ? 'warn' : 'default'}>{plural(onTruck.length, 'item')} still on the truck</Pill>
          ) : (
            <Pill tone="ok">Truck is empty</Pill>
          )}
        </div>
        <ProgressBar
          percent={remainder.vans.length ? Math.round((vansDone / remainder.vans.length) * 100) : 0}
          done={vansDone === remainder.vans.length}
        />
        <p className="tiny muted mt-2">
          Tick a station's van pack from its list. What is still on the truck is worked out from there.
          {unitsLeft ? ` ${formatQty(unitsLeft, 'each')} to go.` : ''}
        </p>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Van packs</h2>
        </div>
        <div className="list">
          {remainder.vans.map((van) => {
            const done = van.linesTotal > 0 && van.linesDone === van.linesTotal;
            return (
              <Link key={van.packlistId} to={`/packlists/${van.packlistId}`} className="row">
                <span className="row-icon">{done ? '✅' : '🚐'}</span>
                <span className="row-body">
                  <span className="row-title truncate">{van.destination.name}</span>
                  <span className="row-sub">
                    {van.destination.vehicle ? `${van.destination.vehicle} · ` : ''}
                    {van.linesDone} of {plural(van.linesTotal, 'line')} in the van
                  </span>
                </span>
                <span className="row-chevron">›</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Still on the truck</h2>
          <span className="small muted">{onTruck.length ? plural(onTruck.length, 'item') : 'nothing'}</span>
        </div>
        {onTruck.length ? (
          <div className="list">
            {onTruck.map((line) => (
              <div key={line.itemId} className="row row-static" style={{ alignItems: 'flex-start' }}>
                <span className="row-body">
                  <span className="row-title truncate">{line.item?.name ?? 'Unknown item'}</span>
                  <span className="row-sub">
                    {formatQty(line.onTruck, line.item?.unit ?? 'each')} on the truck · {line.inVans} in vans
                  </span>
                  {line.short.map((share) => (
                    <span key={share.lineId} className="row-sub" style={{ color: 'var(--warn)' }}>
                      <Link to={`/packlists/${share.packlistId}`}>{share.destination.name}</Link> wants{' '}
                      {share.wants - share.inVan} more
                    </span>
                  ))}
                  {line.spare > 0 ? (
                    <span className="row-sub">{formatQty(line.spare, line.item?.unit ?? 'each')} spare, no station waiting</span>
                  ) : null}
                </span>
                <span className="row-end">
                  <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {line.remaining}
                  </span>
                  {line.short.length ? <Pill tone="warn">waiting</Pill> : <Pill>spare</Pill>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card card-pad center muted">🎉 The truck is empty. Every van has what went on for it.</div>
        )}
      </section>
    </Screen>
  );
}
