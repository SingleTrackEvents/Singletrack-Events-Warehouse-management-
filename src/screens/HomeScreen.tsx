import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { BuildStamp } from '../components/BuildStamp';
import { MovePill, MoveStrip } from '../components/Moves';
import { EmptyState, Pill } from '../components/ui';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { useEvents } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { useToast } from '../components/toastContext';
import { can, isStationOnly } from '../sync/permissions';
import { uncountedSummary } from '../domain/stocktake';
import { describeSource, packlistForDestination, primaryPacklist, progressFor, startPacklist } from '../domain/packlists';
import { boardCounts, currentMove, hasLeft, moveOf, moveProgress, sent } from '../domain/moves';
import { DELIVERY_LABELS, checkInFor, deliveryOf, describeCheckIn } from '../domain/runSheet';
import { RunSheetCard } from '../components/RunSheetCard';
import type { BoardRow, Move } from '../domain/moves';
import { DESTINATION_ICONS, DESTINATION_LABELS, daysUntil, formatDateRange, plural, relativeDays } from '../domain/format';
import type { Destination, Item, Packlist, PacklistLine } from '../db/types';
import logo from '../assets/logo-white.png';
import { openIntro } from '../domain/intro';
import { lastOpenedEvent } from '../domain/format';

/**
 * The screen the crew lands on: the board for the next event.
 *
 * One row per station and five moves across the top, so the first glance says
 * where the weekend is up to and the second says which station is holding it
 * up. Under that, what the shed is short of. Account and sync state live in
 * the header chip, and everything else has a tab, so nothing here repeats
 * what is a tap away.
 */
export default function HomeScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const { session } = useSession();
  const stationOnly = isStationOnly(session);
  const station = useLiveQuery(
    async () => {
      const destinationId = session?.scope.destinationId;
      if (!stationOnly || !destinationId) return undefined;
      const destination = await db.destinations.get(destinationId);
      const packlist = await packlistForDestination(destinationId);
      const lines = packlist
        ? alive(await db.packlistLines.toArray()).filter((line) => line.packlistId === packlist.id)
        : [];
      const items = new Map(alive(await db.items.toArray()).map((item) => [item.id, item]));
      return { destination, packlist, lines, items };
    },
    [stationOnly, session?.scope.destinationId],
  );

  const events = useEvents();

  // The event to lead with: the next one that has not finished yet, otherwise
  // the most recent. Anything "live" jumps the queue.
  const focus = (() => {
    if (!events?.length) return undefined;
    // The event someone last opened, while it is still to come: planning
    // Mt Buller and tapping Event should not land back on GPT100.
    const chosen = events.find((event) => event.id === lastOpenedEvent());
    if (chosen && chosen.status !== 'closed' && daysUntil(chosen.endDate) >= 0) return chosen;
    const live = events.find((event) => event.status === 'live');
    if (live) return live;
    const upcoming = events
      .filter((event) => event.status !== 'closed' && daysUntil(event.endDate) >= 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return upcoming[0] ?? events[events.length - 1];
  })();

  const truckStage = Boolean(focus?.truckStage);
  const board = useLiveQuery(async () => {
    if (!focus) return undefined;
    const destinations = alive(await db.destinations.where('eventId').equals(focus.id).toArray()).sort(
      (a, b) => a.sort - b.sort || a.name.localeCompare(b.name),
    );
    const packlists = alive(await db.packlists.where('eventId').equals(focus.id).toArray());
    const ids = new Set(packlists.map((packlist) => packlist.id));
    const lines = alive(await db.packlistLines.toArray()).filter((line) => ids.has(line.packlistId));
    const linesOf = (packlist: Packlist) => lines.filter((line) => line.packlistId === packlist.id);
    const rows: Array<BoardRow & { destination: Destination }> = destinations.map((destination) => {
      const candidates = packlists.filter((packlist) => packlist.destinationId === destination.id);
      const packlist = primaryPacklist(candidates, (entry) => linesOf(entry).length);
      const own = packlist ? linesOf(packlist) : [];
      const move = packlist ? moveOf(own, truckStage, packlist.status) : 'plan';
      return {
        destination,
        destinationId: destination.id,
        packlistId: packlist?.id ?? null,
        move,
        progress: moveProgress(own, move, truckStage),
        blocking: progressFor(own).blocking.length,
        lists: candidates.length,
      };
    });
    const current = currentMove(rows, truckStage);
    // What is left to do at the move the event is at, across every station.
    const remaining = rows
      .filter((row) => row.move === current)
      .reduce((sum, row) => sum + row.progress.short, 0);
    return { rows, counts: boardCounts(rows), current, remaining };
  }, [focus?.id, truckStage]);
  const [showing, setShowing] = useState<Move | null>(null);
  const canBuild = can(session, 'packlist:manage', focus ? { eventId: focus.id } : undefined);
  const canPackHere = can(session, 'packlist:pack', focus ? { eventId: focus.id } : undefined);

  // The shopping list is one tap away under the board; its own screen holds
  // the lines, so the home screen no longer repeats them.
  const canShop = can(session, 'shopping:manage');
  // Low stock is a warehouse matter: crew given one event read the catalogue
  // but do not restock it, and a restock line carries no event to scope to.
  const canRestock = canShop && can(session, 'stock:adjust');

  const canCount = can(session, 'stocktake:read');
  const openStocktakes = useLiveQuery(
    async () =>
      canCount
        ? alive(await db.stocktakes.toArray()).filter((entry) => entry.status === 'open')
        : [],
    [canCount],
  );

  // A volunteer has one packlist and nothing else to do. Sending them through a
  // dashboard of races they cannot open is a lap of the app for no reason. The
  // branch sits below every hook so the order never changes between renders.
  // The stocktake is how shelves and real counts get recorded, so while
  // anything is uncounted it has a card here rather than a button under More.
  const uncounted = useLiveQuery(() => (canRestock ? uncountedSummary() : null), [canRestock]);
  if (stationOnly) return <StationHome station={station} />;

  return (
    // The artwork is white on transparent, so it sits straight on the teal header.
    <Screen title={<img className="header-logo" src={logo} alt="SingleTrack Events" />}>
      {focus ? (
        <section className="section">
          <div className="section-head">
            <h2>
              <Link to={`/events/${focus.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {focus.name}
              </Link>
            </h2>
            <Link to="/events" className="small">
              All events
            </Link>
          </div>
          <div className="spread mb-3">
            <p className="small muted mt-0">
              {focus.location} · {formatDateRange(focus.startDate, focus.endDate)}
            </p>
            <Pill tone={daysUntil(focus.startDate) <= 7 ? 'accent' : 'info'}>{relativeDays(focus.startDate)}</Pill>
          </div>

          {board ? (
            <>
              <MoveStrip
                counts={board.counts}
                current={board.current}
                truckStage={truckStage}
                selected={showing}
                onSelect={setShowing}
              />
              {board.rows.length ? (
                <div className="list">
                  {board.rows
                    .filter((row) => !showing || row.move === showing)
                    .map((row) => (
                      <button
                        key={row.destinationId}
                        type="button"
                        className="row"
                        onClick={() => {
                          if (row.packlistId) navigate(`/packlists/${row.packlistId}`);
                          else if (canBuild) {
                            void startPacklist(row.destination).then(({ packlist, source }) => {
                              toast(describeSource(source));
                              navigate(`/packlists/${packlist.id}`);
                            });
                          } else navigate(`/events/${focus.id}`);
                        }}
                      >
                        <span className="row-icon">{DESTINATION_ICONS[row.destination.type]}</span>
                        <span className="row-body">
                          <span className="row-title truncate">{row.destination.name}</span>
                          <span className="row-sub">
                            {/* What kind of place it is, so the Halls Gap aid
                                station and the Halls Gap village can't be mixed up. */}
                            {DESTINATION_LABELS[row.destination.type]} ·{' '}
                            {row.packlistId
                              ? row.move === 'plan'
                                ? `${plural(row.progress.total, 'item')} to pack`
                                : `${row.progress.done} of ${plural(row.progress.total, 'item')} done`
                              : 'No list yet'}
                            {row.lists > 1 ? ` · ${row.lists} lists` : ''}
                          </span>
                        </span>
                        <span className="row-end">
                          {row.packlistId ? (
                            <MovePill move={row.move} truckStage={truckStage} progress={row.progress} />
                          ) : (
                            <Pill tone="accent">Start list</Pill>
                          )}
                          {row.blocking ? (
                            <div className="tiny" style={{ color: 'var(--danger)', marginTop: 4 }}>
                              {row.blocking} essential{row.blocking === 1 ? '' : 's'} to pack
                            </div>
                          ) : null}
                        </span>
                      </button>
                    ))}
                </div>
              ) : (
                <p className="small muted">No stations yet. Open the event to add them.</p>
              )}
              <BoardAction eventId={focus.id} current={board.current} remaining={board.remaining} truckStage={truckStage} />
              {/* The event's other screens, one tap from the board rather than
                  found by accident through a back arrow. */}
              <div className="btn-grid mt-2">
                {canBuild ? (
                  <Link className="btn btn-outline" to={`/events/${focus.id}/missing`}>
                    ❓ What's missing
                  </Link>
                ) : null}
                {canPackHere ? (
                  <Link className="btn btn-outline" to={`/events/${focus.id}/warehouse`}>
                    📋 Warehouse list
                  </Link>
                ) : null}
                {canShop ? (
                  <Link className="btn btn-outline" to="/shopping">
                    🛒 Shopping list
                  </Link>
                ) : null}
                <button type="button" className="btn btn-outline" onClick={() => navigate('/scan')}>
                  ⛶ Scan a code
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : (
        <EmptyState
          glyph="🏃"
          title="No events yet"
          body="Add your first race to start building packing lists."
          action={
            <Link to="/events" className="btn btn-primary">
              Add an event
            </Link>
          }
        />
      )}

      {openStocktakes?.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Stocktake in progress</h2>
          </div>
          <div className="list">
            {openStocktakes.map((stocktake) => (
              <Link key={stocktake.id} to={`/stocktake/${stocktake.id}`} className="row">
                <span className="row-icon">🔢</span>
                <span className="row-body">
                  <span className="row-title">{stocktake.name}</span>
                  <span className="row-sub">Tap to keep counting</span>
                </span>
                <span className="row-chevron">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {uncounted ? (
        <Link to={uncounted.href} className="row card mb-3">
          <span className="row-icon">🔢</span>
          <span className="row-body">
            <span className="row-title">{uncounted.title}</span>
            <span className="row-sub">{uncounted.detail}</span>
          </span>
          <span className="row-chevron">›</span>
        </Link>
      ) : null}

      <BuildStamp />
    </Screen>
  );
}

/**
 * The one thing to do next, under the board.
 *
 * Which screen that is depends on the move the event is at: the stations
 * while planning, the shed's pick list while loading, the event's stations
 * from there. Crew who cannot pack get the event instead of the pick list.
 */
function BoardAction({
  eventId,
  current,
  remaining,
  truckStage,
}: {
  eventId: string;
  current: Move;
  remaining: number;
  truckStage: boolean;
}) {
  const { session } = useSession();
  const canPack = can(session, 'packlist:pack', { eventId });
  const left = remaining ? ` · ${plural(remaining, 'item')} to go` : '';
  switch (current) {
    case 'plan':
      return (
        <Link className="btn btn-primary btn-block mt-3" to={`/events/${eventId}`}>
          Open the stations{left}
        </Link>
      );
    case 'truck':
      return canPack ? (
        <Link className="btn btn-primary btn-block mt-3" to={`/events/${eventId}/warehouse`}>
          {truckStage ? 'Load the truck' : 'Load the vehicles'}{left}
        </Link>
      ) : (
        <Link className="btn btn-primary btn-block mt-3" to={`/events/${eventId}`}>
          Open the event
        </Link>
      );
    case 'vans':
      return (
        <Link className="btn btn-primary btn-block mt-3" to={canPack ? `/events/${eventId}/vans` : `/events/${eventId}`}>
          Pack the vans{left}
        </Link>
      );
    case 'station':
      return (
        <Link className="btn btn-primary btn-block mt-3" to={`/events/${eventId}`}>
          Stations checking in{left}
        </Link>
      );
    case 'home':
      return (
        <Link className="btn btn-primary btn-block mt-3" to={canPack ? `/events/${eventId}/home` : `/events/${eventId}`}>
          Count it home{left}
        </Link>
      );
  }
}

/**
 * The whole app, for someone working one aid station.
 *
 * Their packlist and a way back to it. No races to browse, no warehouse, no
 * backup — everything the scope rules already refuse, taken off the screen so a
 * phone held in one hand at a station shows the one thing it is for.
 */
function StationHome({
  station,
}: {
  station:
    | { destination?: Destination; packlist?: Packlist; lines: PacklistLine[]; items: Map<string, Item> }
    | undefined;
}) {
  const { session, backend, phase } = useSession();

  if (!station) {
    return (
      <Screen title="Your station">
        <p className="muted">Loading…</p>
        <BuildStamp />
      </Screen>
    );
  }

  const name = station.destination?.name ?? 'Your aid station';

  if (!station.packlist) {
    return (
      <Screen title={name}>
        <EmptyState
          glyph="📦"
          title="Nothing here yet"
          body="Your packing list has not reached this phone. It will appear once the warehouse has built it and the phone has signal."
        />
        <p className="tiny muted center mt-3">
          Signed in as {session?.displayName}. <Link to="/access">Account</Link>
        </p>
        <BuildStamp />
      </Screen>
    );
  }

  const packlist = station.packlist;
  // What this station has confirmed, not what the warehouse packed: the number
  // on their home screen should be the one they can change. A short line the
  // volunteer has answered for is checked, so the job can end.
  const checkIn = checkInFor(station.lines, sent);
  const delivery = deliveryOf(station.lines, {
    connected: Boolean(backend && session),
    sending: phase === 'pushing',
  });
  // The three jobs at a station, in the order they happen over the day.
  const food = station.lines.filter((line) => station.items.get(line.itemId)?.consumable);
  const gear = station.lines.filter((line) => !station.items.get(line.itemId)?.consumable);
  const counted = food.filter(hasLeft).length;
  const packedDown = gear.filter(hasLeft).length;
  const jobs: Array<{ mode: string; title: string; sub: string; done: boolean; icon: string }> = [
    {
      mode: 'arrived',
      icon: '✅',
      title: 'Arrived',
      sub: checkIn.checked ? describeCheckIn(checkIn) : `${plural(checkIn.total, 'item')} to check in off the van`,
      done: checkIn.done,
    },
    {
      mode: 'count',
      icon: '🔢',
      title: 'Count',
      sub: food.length
        ? `${counted} of ${food.length} used-up things counted (food, drink, sunscreen, paper towel)`
        : 'Nothing on this list gets used up',
      done: food.length > 0 && counted === food.length,
    },
    {
      mode: 'packdown',
      icon: '🚐',
      title: 'Pack down',
      sub: gear.length ? `${packedDown} of ${plural(gear.length, 'gear item')} back in the van` : 'No gear on this list',
      done: gear.length > 0 && packedDown === gear.length,
    },
  ];
  const next = jobs.find((job) => !job.done) ?? jobs[0];

  return (
    <Screen title={name} subtitle={session ? `Signed in as ${session.displayName}` : undefined}>
      {/* Said in words, big: a volunteer handed a phone should know at once
          this is their station and nobody else's. */}
      <div className="station-hello mb-3">
        <div className="small muted">Your station</div>
        <div className="station-hello-name">{name}</div>
        {station.destination ? (
          <div className="small">
            {DESTINATION_LABELS[station.destination.type]}
            {station.destination.courseKm !== null ? ` · ${station.destination.courseKm} km` : ''}
          </div>
        ) : null}
      </div>
      {station.destination ? <RunSheetCard destination={station.destination} /> : null}
      <div className="list mb-2">
        {jobs.map((job) => (
          <Link key={job.mode} to={`/packlists/${packlist.id}?mode=${job.mode}`} className="row">
            <span className="row-icon">{job.icon}</span>
            <span className="row-body">
              <span className="row-title">{job.title}</span>
              <span className="row-sub">{job.sub}</span>
            </span>
            <span className="row-end">
              {job.done ? <Pill tone="ok">Done</Pill> : job === next ? <Pill tone="accent">Next</Pill> : null}
            </span>
          </Link>
        ))}
      </div>

      {/* Whether the phone can go back in the pocket: the volunteer cannot
          see the sync engine, so it is said in words. */}
      {checkIn.checked ? (
        <div className={`notice mb-4${delivery === 'sent' ? '' : ' notice-warn'}`}>
          {delivery === 'sent' ? '✅' : delivery === 'sending' ? '⏳' : '📱'} {DELIVERY_LABELS[delivery]}
        </div>
      ) : (
        <div className="mb-4" />
      )}

      {jobs.every((job) => job.done) ? (
        <div className="card card-pad center mb-3">
          <strong>🎉 This station is done.</strong>
          <p className="small muted mt-2">
            Everything is checked in, counted and back in the van. {DELIVERY_LABELS[delivery]}.
          </p>
        </div>
      ) : null}

      <Link className="btn btn-primary btn-lg btn-block" to={`/packlists/${packlist.id}?mode=${next.mode}`}>
        {next.icon} {next.title}
      </Link>

      <p className="tiny muted center mt-4">
        Tick off each item as it turns up, count what is left at the end of the day, and tick the
        gear back into the van. What was sent is set by the warehouse, so a short delivery stays
        visible.{' '}
        <button type="button" className="link-btn" onClick={openIntro}>
          How this works
        </button>{' '}
        · <Link to="/access">Account</Link>
      </p>
      <BuildStamp />
    </Screen>
  );
}
