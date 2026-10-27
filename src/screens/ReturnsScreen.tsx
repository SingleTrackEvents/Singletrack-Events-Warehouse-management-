import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Pill, ProgressBar, Stepper } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { update } from '../db/repo';
import { useSearch } from '../hooks/useSearch';
import { useCategories, useEvent } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import { bookReturns, homeListFor, isHome, setHome } from '../domain/returns';
import type { HomeLine } from '../domain/returns';
import { formatDateTime, formatQty, plural } from '../domain/format';
import { categoryLabel, groupByCategory } from '../domain/grouping';

type Filter = 'todo' | 'all' | 'gaps';

const FILTER_LABELS: Record<Filter, string> = {
  todo: 'To count in',
  all: 'Everything',
  gaps: 'Gaps',
};

/**
 * Counting it home: the mirror of the warehouse list.
 *
 * One line per item that went out, in bin order, with what should come
 * back and what has been counted back. Tapping a line counts it home at
 * what was expected; the breakdown handles the odd one. "Unloaded" books
 * the lot onto the shelf, once, with the gaps left showing.
 */
export default function ReturnsScreen() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const toast = useToast();
  const { session } = useSession();
  const list = useLiveQuery(async () => (eventId ? homeListFor(eventId) : undefined), [eventId]);
  const categories = useCategories();
  const canCount = can(session, 'stock:adjust') && can(session, 'packlist:pack', eventId ? { eventId } : undefined);

  const [filter, setFilter] = useState<Filter>('todo');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [booking, setBooking] = useState(false);

  const toggle = (itemId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const filtered = useMemo(() => {
    const lines = list?.lines ?? [];
    if (filter === 'todo') return lines.filter((line) => !isHome(line));
    if (filter === 'gaps') return lines.filter((line) => line.gap !== 0);
    return lines;
  }, [list, filter]);

  const searched = useSearch(filtered, query, (line) => [
    line.item?.name ?? '',
    line.item?.sku ?? '',
    line.item?.bin ?? '',
    ...line.going.map((entry) => entry.destination.name),
  ]);

  const grouped = useMemo(
    () => groupByCategory(searched, (line) => line.item?.categoryId ?? null, categories ?? []),
    [searched, categories],
  );

  if (!event || !list) {
    return (
      <Screen title="Count it home" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  if (!list.lines.length) {
    return (
      <Screen title="Count it home" subtitle={event.name} back={`/events/${event.id}`}>
        <EmptyState
          glyph="🏠"
          title="Nothing has gone out yet"
          body="Once gear has left the warehouse for this event, what should come back gathers here."
          action={
            <Link className="btn btn-primary" to={`/events/${event.id}`}>
              Back to the event
            </Link>
          }
        />
      </Screen>
    );
  }

  const home = list.lines.filter(isHome).length;
  // What booking now would do: on, off (a lowered count), and what stays off
  // because more came home than went out.
  const pending = list.lines.filter((line) => line.changed);
  const goingOn = pending.reduce((sum, line) => sum + Math.max(0, line.toBook), 0);
  const comingOff = pending.reduce((sum, line) => sum + Math.max(0, -line.toBook), 0);
  const overIssued = list.lines.filter((line) => line.overIssued > 0);
  const missing = list.lines.filter((line) => line.gap < 0).length;
  const percent = list.lines.length ? Math.round((home / list.lines.length) * 100) : 0;

  return (
    <Screen title="Count it home" subtitle={event.name} back={`/events/${event.id}`}>
      <div className="card card-pad mb-3">
        <div className="spread mb-2">
          <span className="strong">
            {home} of {plural(list.lines.length, 'item')} home
          </span>
          {missing ? <Pill tone="warn">{missing} short</Pill> : home === list.lines.length ? <Pill tone="ok">All home</Pill> : null}
        </div>
        <ProgressBar percent={percent} done={percent === 100} />
        <p className="tiny muted mt-2">
          Expected is what each station counted, what arrived for gear, and nothing for food and drink
          nobody counted. Back from {plural(list.stations, 'station')}.
          {event.truckUnloadedAt ? ` Last booked in ${formatDateTime(event.truckUnloadedAt)}.` : ''}
        </p>
        {canCount ? (
          <button
            type="button"
            className="btn btn-primary btn-block mt-3"
            disabled={!pending.length}
            onClick={() => setBooking(true)}
          >
            {event.truckUnloadedAt ? 'Book the changes onto the shelf' : 'Unloaded: book it onto the shelf'}
            {goingOn || comingOff ? ` (${formatQty(goingOn - comingOff, 'each')})` : ''}
          </button>
        ) : null}
      </div>

      <div className="search-bar">
        <input
          className="input grow"
          placeholder="Find an item or a station"
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
        <div>
          {grouped.map(([categoryId, lines]) => (
            <section key={categoryId ?? 'uncategorised'} className="pack-group">
              {grouped.length > 1 ? (
                <div className="pack-group-head">
                  {categoryLabel(categoryId, categories ?? [])}
                  <span className="muted"> · {lines.length}</span>
                </div>
              ) : null}
              <div className="list">
                {lines.map((line) => (
                  <HomeRow
                    key={line.itemId}
                    line={line}
                    open={open.has(line.itemId)}
                    onToggle={() => toggle(line.itemId)}
                    canCount={canCount}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card card-pad center muted">
          {filter === 'todo' ? '🎉 Everything is counted home.' : filter === 'gaps' ? '✅ Nothing is missing.' : 'Nothing to show.'}
        </div>
      )}

      {booking ? (
        <ConfirmSheet
          title="Book the returns onto the shelf?"
          body={
            <>
              {goingOn ? `${formatQty(goingOn, 'each')} goes back into the warehouse count now, once. ` : ''}
              {comingOff ? `${formatQty(comingOff, 'each')} comes back off, for counts lowered since they were booked. ` : ''}
              Anything counted later can be booked the same way and only the difference changes.
              {overIssued.length ? (
                <span className="block mt-2" style={{ color: 'var(--warn)' }}>
                  More came home than went out of the warehouse for{' '}
                  {overIssued.map((line) => `${line.item?.name ?? 'an item'} (${formatQty(line.overIssued, line.item?.unit ?? 'each')})`).join(', ')}.
                  The extra is not booked: count those on the shelf with a stocktake.
                </span>
              ) : null}
            </>
          }
          confirmLabel="Book it in"
          onCancel={() => setBooking(false)}
          onConfirm={() => {
            setBooking(false);
            void bookReturns(event.id, session?.displayName ?? '').then(({ lines, units }) =>
              toast(
                !lines
                  ? 'Nothing new to book'
                  : units < 0
                    ? `Booked: ${formatQty(-units, 'each')} off the shelf`
                    : `Booked in: ${formatQty(units, 'each')} back on the shelf`,
              ),
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

/** One item coming home, with its stations folded away until asked for. */
function HomeRow({
  line,
  open,
  onToggle,
  canCount,
}: {
  line: HomeLine;
  open: boolean;
  onToggle: () => void;
  canCount: boolean;
}) {
  const unit = line.item?.unit ?? 'each';
  const done = isHome(line);
  const tick = (shares: HomeLine['going'], home: boolean) => {
    void setHome(shares, home);
    if (home && navigator.vibrate) navigator.vibrate(15);
  };
  return (
    <div className={`pull-row${done ? ' done' : line.counted > 0 ? ' short' : ''}`}>
      <div className="pull-head">
        {canCount ? (
          <button
            type="button"
            className="pull-tick"
            aria-pressed={done}
            aria-label={`${done ? 'Uncount' : 'Count'} ${line.item?.name ?? 'item'} home from every station`}
            onClick={() => tick(line.going, !done)}
          >
            ✓
          </button>
        ) : null}
        <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
          <span className="row-body">
            <span className="row-title truncate">{line.item?.name ?? 'Unknown item'}</span>
            <span className="row-sub">
              {line.item?.bin ? `Shelf ${line.item.bin} · ` : ''}sent {formatQty(line.sent, unit)} · {plural(line.going.length, 'station')}
            </span>
          </span>
          <span className="row-end stack-sm" style={{ alignItems: 'flex-end' }}>
            <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {line.counted} / {line.expected}
            </span>
            {line.gap < 0 && line.counted > 0 ? (
              <Pill tone="warn">{-line.gap} short</Pill>
            ) : line.gap > 0 ? (
              <Pill tone="info">{line.gap} over</Pill>
            ) : line.overIssued > 0 ? (
              <Pill tone="warn">{line.overIssued} more than went out</Pill>
            ) : line.changed && line.toBook ? (
              <span className="tiny muted">{line.toBook > 0 ? `${line.toBook} to book` : `${-line.toBook} to take off`}</span>
            ) : null}
          </span>
        </button>
      </div>

      {open ? (
        <div className="pull-breakdown">
          {line.going.map((share) => (
            <div key={share.lineId} className="pull-going-row">
              <Link className="pull-going" to={`/packlists/${share.packlistId}?mode=home`}>
                <span className="truncate">
                  {share.destination.name}
                  <span className="tiny muted"> · {share.stationCounted ? 'station counted' : 'expected'} {share.expected}</span>
                </span>
              </Link>
              {canCount ? (
                <Stepper
                  label={`home from ${share.destination.name}`}
                  value={share.counted}
                  onChange={(value) => void update(db.packlistLines, share.lineId, { qtyReturned: value })}
                />
              ) : (
                <span className="strong">{share.counted}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
