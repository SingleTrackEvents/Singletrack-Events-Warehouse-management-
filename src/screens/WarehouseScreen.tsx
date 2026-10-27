import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Pill, ProgressBar } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSearch } from '../hooks/useSearch';
import { useCategories, useEvent } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import { adoptVehiclesFromLoads, byVehicle, isPulled, pullListCsv, pullListFor, restoreLines, setPulled } from '../domain/warehouse';
import { issueLoaded, setOnTruck } from '../domain/truck';
import { downloadCsv, slugify } from '../domain/backup';
import { formatDateTime, formatQty, plural } from '../domain/format';
import { categoryLabel, groupByCategory } from '../domain/grouping';
import type { PullDestination, PullLine, PullList } from '../domain/warehouse';

type Filter = 'all' | 'todo' | 'short' | 'noRun';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Everything',
  todo: 'To pack',
  short: 'Not enough stock',
  noRun: 'No vehicle yet',
};

/**
 * One spelling for each vehicle before the list is split by vehicle.
 *
 * Vehicles are typed per station, so "Pantech #1" on one and "pantech #1 " on
 * another are the same truck and must be one load, not two. Matched without
 * case or extra spaces; the group takes the spelling most stations use.
 */
function oneSpellingPerVehicle(list: PullList): PullList {
  const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const counts = new Map<string, Map<string, number>>();
  for (const line of list.lines) {
    for (const going of line.going) {
      if (!going.vehicle) continue;
      const spelling = going.vehicle.trim().replace(/\s+/g, ' ');
      const forKey = counts.get(key(spelling)) ?? new Map<string, number>();
      forKey.set(spelling, (forKey.get(spelling) ?? 0) + 1);
      counts.set(key(spelling), forKey);
    }
  }
  const chosen = new Map<string, string>();
  for (const [name, spellings] of counts) {
    // A tie goes to the one written with capitals: "Pantech #1" over "pantech #1".
    const capitals = (text: string) => text.replace(/[^A-Z]/g, '').length;
    const [best] = [...spellings].sort(
      (a, b) => b[1] - a[1] || capitals(b[0]) - capitals(a[0]) || a[0].localeCompare(b[0]),
    );
    chosen.set(name, best[0]);
  }
  return {
    ...list,
    lines: list.lines.map((line) => ({
      ...line,
      going: line.going.map((going) =>
        going.vehicle ? { ...going, vehicle: chosen.get(key(going.vehicle)) ?? going.vehicle } : going,
      ),
    })),
  };
}

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
  const categories = useCategories();
  const { session } = useSession();
  // Ticking packs the station lists, so it takes packing rights, not just
  // the right to read the list.
  const canTick = can(session, 'packlist:pack');
  // A two-stage event ticks gear onto the truck here; the stations' own lists
  // are then the van packs at the event.
  const truck = Boolean(event?.truckStage);
  // Items where loading now takes out more than the shelf was counted at.
  const overdrawn = (list?.lines ?? [])
    .map((line) => ({ ...line, going: (truck ? line.qtyOnTruck : line.qtyPacked) - line.qtyIssued }))
    .filter((line) => !line.uncounted && line.going > 0 && line.going > line.qtyOnHand);
  const [loadingTruck, setLoadingTruck] = useState(false);
  // A transport plan made before vehicles were tags is written onto the
  // stations once, by whoever may edit them, so it keeps reading the same.
  const canTag = can(session, 'event:write', eventId ? { eventId } : undefined);
  useEffect(() => {
    if (eventId && canTag) void adoptVehiclesFromLoads(eventId);
  }, [eventId, canTag]);

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
    if (filter === 'todo') return lines.filter((line) => !isPulled(line, truck));
    // Stock nobody has counted cannot be called enough: it shows here as unknown.
    if (filter === 'short') return lines.filter((line) => line.shortfall > 0 || line.uncounted);
    if (filter === 'noRun') return lines.filter((line) => line.going.some((entry) => !entry.vehicle));
    return lines;
  }, [list, filter, truck]);

  const searched = useSearch(filtered, query, (line) => [
    line.item?.name ?? '',
    line.item?.sku ?? '',
    line.item?.bin ?? '',
    ...line.going.map((entry) => entry.destination.name),
  ]);

  const vehicles = useMemo(() => (list ? byVehicle(oneSpellingPerVehicle(list)) : []), [list]);

  /*
   * Sections by category, keeping bin order inside each one. The picking pass
   * walks the shed a corner at a time, so all the water gear wants to be in
   * one place — alphabetical order scatters it across the whole list.
   */
  const grouped = useMemo(
    () => groupByCategory(searched, (line) => line.item?.categoryId ?? null, categories ?? []),
    [searched, categories],
  );

  if (!event || !list) {
    return (
      <Screen title="Warehouse list" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const shortCount = list.lines.filter((line) => line.shortfall > 0).length;
  const uncounted = list.lines.filter((line) => line.uncounted).length;
  const totalPacked = list.lines.reduce((sum, line) => sum + (truck ? line.qtyOnTruck : line.qtyPacked), 0);
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
          body="Build the packing lists for this event's stations and their totals gather here."
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
            {plural(list.lines.length, 'item')} across {plural(list.destinationsCovered, 'station')}
          </span>
          {/*
            "Warehouse covers it" is a claim, and it cannot be made about stock
            nobody has counted. Uncounted lines are reported as themselves.
          */}
          {shortCount ? (
            <Pill tone="danger">{shortCount} short</Pill>
          ) : uncounted ? (
            <Pill tone="warn">{uncounted} stock unknown</Pill>
          ) : (
            <Pill tone="ok">Warehouse covers it</Pill>
          )}
        </div>
        <ProgressBar percent={percent} done={percent === 100} />
        <p className="tiny muted mt-2">
          {formatQty(totalPacked, 'each')} of {formatQty(totalNeeded, 'each')} {truck ? 'on the truck' : 'packed'}
        </p>
        <p className="tiny muted mt-2">
          {truck
            ? '🚛 Tick gear onto the truck here. Each station\'s own list is its van pack at the event.'
            : '🚐 Tick gear as it is packed for each station\'s vehicle.'}
          {event.truckLoadedAt && !event.truckRuns?.length ? ` Last marked loaded ${formatDateTime(event.truckLoadedAt)}.` : ''}
        </p>
        {/* Each load is its own run: GPT goes out bulky gear first, the rest days later. */}
        {event.truckRuns?.length ? (
          <ol className="tiny mt-2" style={{ paddingLeft: '1.2rem' }}>
            {event.truckRuns.map((run, index) => (
              <li key={run.at}>
                {truck ? `Truck run ${index + 1}` : `Load ${index + 1}`}, {formatDateTime(run.at)}
                {run.by ? ` by ${run.by}` : ''}: {formatQty(run.units, 'each')} out
                {run.returned ? `, ${formatQty(run.returned, 'each')} taken back off` : ''}
              </li>
            ))}
          </ol>
        ) : null}
        {list.unassigned.length ? (
          <p className="tiny mt-2" style={{ color: 'var(--warn)' }}>
            ⚠ {plural(list.unassigned.length, 'station')} with no vehicle yet:{' '}
            {list.unassigned.map((entry) => entry.name).join(', ')}.{' '}
            <Link to={`/events/${event.id}`}>Set the vehicle on the station</Link>.
          </p>
        ) : null}
      </div>

      {uncounted ? (
        <p className="small mb-3" style={{ color: 'var(--warn)' }}>
          ⚠ The warehouse has never counted {plural(uncounted, 'item')} on this list, so it can't say if
          there are enough. <Link to="/stocktake">Count them in a stocktake</Link>.
        </p>
      ) : null}

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
                      <PullRow
                        key={line.itemId}
                        line={line}
                        open={open.has(line.itemId)}
                        onToggle={() => toggle(line.itemId)}
                        canTick={canTick}
                        truck={truck}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="card card-pad center muted">
              {filter === 'short' ? '✅ The warehouse has counted enough of everything on this list.' : 'Nothing to show.'}
            </div>
          )}
        </>
      ) : (
        <div className="stack">
          {vehicles.map((group) => (
            <section key={group.vehicle ?? 'unassigned'} className="section">
              <div className="section-head">
                <h2>{group.vehicle ?? 'No vehicle yet'}</h2>
                {!group.vehicle ? (
                  <Link className="btn btn-ghost btn-sm" to={`/events/${event.id}`}>
                    Set on the station
                  </Link>
                ) : null}
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
                        {entry.item?.bin ? `Shelf ${entry.item.bin}` : ''}
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
      {/* The one button that takes stock out, kept to the foot of the list
          and worded as what has happened, so nobody taps it while packing. */}
      {canTick ? (
        <section className="section no-print">
          <div className="btn-grid mb-2">
            <Link className="btn btn-outline" to={`/events/${event.id}/vans/sheet`}>
              🖨 Van sheets
            </Link>
            <Link className="btn btn-outline" to={`/events/${event.id}/missing`}>
              ❓ What's missing
            </Link>
          </div>
          <div className="card card-pad">
            <p className="small mb-2">
              {truck
                ? 'When the truck is packed and leaving, take its gear out of the warehouse count here.'
                : 'When the vehicles are packed and leaving, take their gear out of the warehouse count here.'}
            </p>
            <button
              type="button"
              className="btn btn-outline btn-block"
              disabled={!totalPacked}
              onClick={() => setLoadingTruck(true)}
            >
              {event.truckLoadedAt
                ? 'More went on since: take out the difference'
                : truck
                  ? '🚛 The truck has left: take it out of stock'
                  : '🚐 The vehicles have left: take it out of stock'}
            </button>
          </div>
        </section>
      ) : null}

      {loadingTruck ? (
        <ConfirmSheet
          title={truck ? 'Mark the truck loaded?' : 'Mark the vehicles loaded?'}
          body={
            <>
              Everything ticked {truck ? 'onto the truck' : 'as packed'} comes out of the warehouse count
              now, once, and nothing later takes it out again. If more goes on afterwards, or something
              comes off to make room, mark it loaded again and only the difference changes.
              {overdrawn.length ? (
                <span className="block mt-2" style={{ color: 'var(--danger)' }}>
                  ⚠ More is going than the warehouse has counted:{' '}
                  {overdrawn
                    .slice(0, 5)
                    .map((entry) => `${entry.item?.name ?? 'item'} (${formatQty(entry.going, entry.item?.unit ?? 'each')} going, ${formatQty(entry.qtyOnHand, entry.item?.unit ?? 'each')} counted)`)
                    .join(', ')}
                  {overdrawn.length > 5 ? ` and ${overdrawn.length - 5} more` : ''}. Their counts will go below zero
                  until someone counts them.
                </span>
              ) : null}
            </>
          }
          confirmLabel={truck ? 'Truck loaded' : 'Vehicles loaded'}
          onCancel={() => setLoadingTruck(false)}
          onConfirm={() => {
            setLoadingTruck(false);
            void issueLoaded(event.id, truck, session?.displayName ?? '').then(({ lines, units, returned }) => {
              const run = (event.truckRuns?.length ?? 0) + 1;
              const parts = [
                lines ? `${formatQty(units, 'each')} out of the warehouse` : '',
                returned ? `${formatQty(returned, 'each')} back on the shelf` : '',
              ].filter(Boolean);
              toast(parts.length ? `${truck ? `Truck run ${run}` : 'Loaded'}: ${parts.join(', ')}` : 'Nothing has changed since it was loaded');
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

/** One item, with its destinations folded away until asked for. */
function PullRow({
  line,
  open,
  onToggle,
  canTick,
  truck,
}: {
  line: PullLine;
  open: boolean;
  onToggle: () => void;
  canTick: boolean;
  /** Two-stage event: ticks put gear on the truck rather than packing each station. */
  truck: boolean;
}) {
  const unit = line.item?.unit ?? 'each';
  const done = isPulled(line, truck);
  const counted = (entry: { qtyPacked: number; qtyOnTruck: number }) => (truck ? entry.qtyOnTruck : entry.qtyPacked);
  const verb = truck ? 'on the truck' : 'packed';
  // A loaded list's count is fixed, so a line that is all loaded cannot be ticked.
  const tickable = canTick && line.going.some((going) => going.canPack);
  const toast = useToast();
  const tick = (shares: PullDestination[], packed: boolean) => {
    void (truck ? setOnTruck(shares, packed) : setPulled(shares, packed)).then((before) => {
      // One tap here writes to every station's list, so a mis-tap gets one
      // tap back rather than a dozen stations recounted.
      if (before.length > 1 || !packed) {
        toast(`${line.item?.name ?? 'Item'} ${packed ? verb : `taken off ${plural(before.length, 'list')}`}`, 'ok', {
          undo: () => restoreLines(truck ? 'qtyOnTruck' : 'qtyPacked', before),
        });
      }
    });
    if (packed && navigator.vibrate) navigator.vibrate(15);
  };
  return (
    <div className={`pull-row${done ? ' done' : counted(line) > 0 ? ' short' : ''}`}>
      <div className="pull-head">
      {canTick ? (
        <button
          type="button"
          className="pull-tick"
          aria-pressed={done}
          disabled={!tickable}
          aria-label={`${done ? 'Untick' : 'Tick'} ${line.item?.name ?? 'item'} ${verb} for every station`}
          onClick={() => tick(line.going, !done)}
        >
          ✓
        </button>
      ) : null}
      <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
        <span className="row-body">
          <span className="row-title truncate">{line.item?.name ?? 'Unknown item'}</span>
          <span className="row-sub">
            {line.item?.bin ? `Shelf ${line.item.bin} · ` : ''}
            {plural(line.going.length, 'station')}
          </span>
        </span>
        <span className="row-end stack-sm" style={{ alignItems: 'flex-end' }}>
          <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatQty(line.qtyRequired, unit)}
          </span>
          {counted(line) > 0 && !done ? (
            <span className="tiny muted">{counted(line)} {verb}</span>
          ) : null}
          {line.shortfall > 0 ? (
            <Pill tone="danger">short {line.shortfall}</Pill>
          ) : line.uncounted ? (
            <Pill tone="warn">stock unknown</Pill>
          ) : (
            <span className="tiny muted">{line.qtyOnHand} on hand</span>
          )}
        </span>
      </button>
      </div>

      {open ? (
        <div className="pull-breakdown">
          {line.going.map((going) => (
            <div key={going.lineId} className="pull-going-row">
            {canTick ? (
              <button
                type="button"
                className="pull-tick pull-tick-sm"
                aria-pressed={counted(going) >= going.qtyRequired}
                disabled={!going.canPack}
                aria-label={`${counted(going) >= going.qtyRequired ? 'Untick' : 'Tick'} ${verb} for ${going.destination.name}`}
                onClick={() => tick([going], counted(going) < going.qtyRequired)}
              >
                ✓
              </button>
            ) : null}
            <Link
              className="pull-going"
              to={`/packlists/${going.packlistId}`}
            >
              <span className="truncate">
                {going.destination.name}
                <span className="tiny muted">
                  {' '}
                  · {going.vehicle ?? 'no vehicle yet'}
                </span>
              </span>
              <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {counted(going)}/{going.qtyRequired}
              </span>
            </Link>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
