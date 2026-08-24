import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState, Pill, ProgressBar } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSearch } from '../hooks/useSearch';
import { useEvent } from '../hooks/useDb';
import { byVehicle, pullListCsv, pullListFor } from '../domain/warehouse';
import { downloadCsv, slugify } from '../domain/backup';
import { formatQty, plural } from '../domain/format';
import type { PullLine } from '../domain/warehouse';

type Filter = 'all' | 'short' | 'noRun';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Everything',
  short: 'Short in the shed',
  noRun: 'No run yet',
};

/**
 * One list for the whole event, for the person standing in the warehouse.
 *
 * A packlist answers "what goes to Aid 3". Nobody walks the racks eleven times,
 * so this is the other question: how many trestle tables does the weekend need
 * in total, where are they going, and which vehicle takes them.
 *
 * Two ways to read it. By item, in bin order, is the picking pass — pull the
 * whole total once. By vehicle is the loading pass — what goes in the Hilux.
 */
export default function WarehouseScreen() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const toast = useToast();
  const list = useLiveQuery(async () => (eventId ? pullListFor(eventId) : undefined), [eventId]);

  const [grouping, setGrouping] = useState<'item' | 'vehicle'>('item');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (itemId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const filtered = useMemo(() => {
    const lines = list?.lines ?? [];
    if (filter === 'short') return lines.filter((line) => line.shortfall > 0);
    if (filter === 'noRun') return lines.filter((line) => line.going.some((entry) => !entry.load));
    return lines;
  }, [list, filter]);

  const searched = useSearch(filtered, query, (line) => [
    line.item?.name ?? '',
    line.item?.sku ?? '',
    line.item?.bin ?? '',
    ...line.going.map((entry) => entry.destination.name),
  ]);

  const vehicles = useMemo(() => (list ? byVehicle(list) : []), [list]);

  if (!event || !list) {
    return (
      <Screen title="Warehouse list" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const shortCount = list.lines.filter((line) => line.shortfall > 0).length;
  const uncounted = list.lines.filter((line) => line.uncounted).length;
  const totalPacked = list.lines.reduce((sum, line) => sum + line.qtyPacked, 0);
  const totalNeeded = list.lines.reduce((sum, line) => sum + line.qtyRequired, 0);
  const percent = totalNeeded ? Math.round((totalPacked / totalNeeded) * 100) : 0;

  const exportCsv = () => {
    downloadCsv(pullListCsv(list), `${slugify(event.name)}-warehouse-list.csv`);
    toast('CSV saved to downloads');
  };

  if (!list.lines.length) {
    return (
      <Screen title="Warehouse list" subtitle={event.name} back={`/events/${event.id}`}>
        <EmptyState
          glyph="📦"
          title="Nothing to pull yet"
          body="Build the packlists for this event's destinations and their totals gather here."
          action={
            <Link className="btn btn-primary" to={`/events/${event.id}`}>
              Back to the event
            </Link>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title="Warehouse list" subtitle={event.name} back={`/events/${event.id}`}>
      <div className="card card-pad mb-3">
        <div className="spread mb-2">
          <span className="strong">
            {plural(list.lines.length, 'item')} across {plural(list.destinationsCovered, 'destination')}
          </span>
          {/*
            "Warehouse covers it" is a claim, and it cannot be made about stock
            nobody has counted. Uncounted lines are reported as themselves.
          */}
          {shortCount ? (
            <Pill tone="danger">{shortCount} short</Pill>
          ) : uncounted ? (
            <Pill>{uncounted} not counted</Pill>
          ) : (
            <Pill tone="ok">Warehouse covers it</Pill>
          )}
        </div>
        <ProgressBar percent={percent} done={percent === 100} />
        <p className="tiny muted mt-2">
          {formatQty(totalPacked, 'each')} of {formatQty(totalNeeded, 'each')} packed
        </p>
        {list.unassigned.length ? (
          <p className="tiny mt-2" style={{ color: 'var(--warn)' }}>
            ⚠ {plural(list.unassigned.length, 'destination')} packed with no run yet:{' '}
            {list.unassigned.map((entry) => entry.name).join(', ')}.{' '}
            <Link to={`/transport?event=${event.id}`}>
              Put {list.unassigned.length === 1 ? 'it' : 'them'} on a vehicle
            </Link>
            .
          </p>
        ) : null}
      </div>

      <div className="chip-row mb-3">
        <button
          type="button"
          className="chip"
          aria-pressed={grouping === 'item'}
          onClick={() => setGrouping('item')}
        >
          📦 By item
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={grouping === 'vehicle'}
          onClick={() => setGrouping('vehicle')}
        >
          🚚 By vehicle
        </button>
      </div>

      {grouping === 'item' ? (
        <>
          <div className="search-bar">
            <input
              className="input grow"
              placeholder="Find an item or a destination"
              value={query}
              onChange={(changed) => setQuery(changed.target.value)}
            />
          </div>

          <div className="chip-row mb-3">
            {(Object.keys(FILTER_LABELS) as Filter[]).map((option) => (
              <button
                key={option}
                type="button"
                className="chip"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
              >
                {FILTER_LABELS[option]}
              </button>
            ))}
          </div>

          {searched.length ? (
            <div className="list">
              {searched.map((line) => (
                <PullRow
                  key={line.itemId}
                  line={line}
                  open={open.has(line.itemId)}
                  onToggle={() => toggle(line.itemId)}
                />
              ))}
            </div>
          ) : (
            <div className="card card-pad center muted">
              {filter === 'short' ? '✅ The shed covers everything on this list.' : 'Nothing to show.'}
            </div>
          )}
        </>
      ) : (
        <div className="stack">
          {vehicles.map((group) => (
            <section key={group.load?.id ?? 'unassigned'} className="section">
              <div className="section-head">
                <h2>{group.load ? `${group.load.vehicle || group.load.name}` : 'Not on a run yet'}</h2>
                {group.load ? (
                  <Link className="btn btn-ghost btn-sm" to={`/transport/${group.load.id}`}>
                    Open run
                  </Link>
                ) : (
                  <Link className="btn btn-ghost btn-sm" to={`/transport?event=${event.id}`}>
                    Assign
                  </Link>
                )}
              </div>
              <p className="tiny muted mb-2">
                {group.destinations.map((entry) => entry.name).join(' · ')}
              </p>
              <div className="list">
                {group.lines.map((entry) => (
                  <div key={entry.itemId} className="row row-static">
                    <span className="row-body">
                      <span className="row-title truncate">{entry.item?.name ?? 'Unknown item'}</span>
                      <span className="row-sub">
                        {entry.item?.bin || 'no bin'} · {entry.item?.sku ?? ''}
                      </span>
                    </span>
                    <span className="row-end">
                      <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatQty(entry.qtyRequired, entry.item?.unit ?? 'each')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="btn-row mt-4 no-print">
        <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv}>
          ⬇ CSV
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>
    </Screen>
  );
}

/** One item, with its destinations folded away until asked for. */
function PullRow({
  line,
  open,
  onToggle,
}: {
  line: PullLine;
  open: boolean;
  onToggle: () => void;
}) {
  const unit = line.item?.unit ?? 'each';
  return (
    <div className="pull-row">
      <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
        <span className="row-body">
          <span className="row-title truncate">{line.item?.name ?? 'Unknown item'}</span>
          <span className="row-sub">
            {line.item?.bin || 'no bin'} · {line.item?.sku ?? ''} ·{' '}
            {plural(line.going.length, 'stop')}
          </span>
        </span>
        <span className="row-end stack-sm" style={{ alignItems: 'flex-end' }}>
          <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatQty(line.qtyRequired, unit)}
          </span>
          {line.shortfall > 0 ? (
            <Pill tone="danger">short {line.shortfall}</Pill>
          ) : line.uncounted ? (
            <Pill>not counted</Pill>
          ) : (
            <span className="tiny muted">{line.qtyOnHand} on hand</span>
          )}
        </span>
      </button>

      {open ? (
        <div className="pull-breakdown">
          {line.going.map((going) => (
            <Link
              key={going.packlistId}
              className="pull-going"
              to={`/packlists/${going.packlistId}`}
            >
              <span className="truncate">
                {going.destination.name}
                <span className="tiny muted">
                  {' '}
                  · {going.load ? going.load.vehicle || going.load.name : 'no run yet'}
                </span>
              </span>
              <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {going.qtyPacked}/{going.qtyRequired}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
