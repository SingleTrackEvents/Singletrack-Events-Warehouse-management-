import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState, Pill, ProgressBar } from '../components/ui';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { useEvents, useItems, useSettings } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { SignInPrompt } from '../components/SignInPrompt';
import { ROLE_LABELS } from '../sync/types';
import { isStationOnly } from '../sync/permissions';
import { countedItemIds, isUncounted, lowStockItems } from '../domain/stock';
import { packlistForDestination, progressFor, receiptFor } from '../domain/packlists';
import { daysUntil, formatDateRange, formatDateTime, plural, relativeDays } from '../domain/format';
import { LOAD_STATUS_LABELS } from '../domain/transport';
import type { Destination, Packlist, PacklistLine } from '../db/types';
import logo from '../assets/logo-white.png';

/**
 * Says plainly who is signed in and whether their work has left the phone.
 *
 * The sync state is not a technical detail here: a crew member who has packed
 * four stations needs to know that landed somewhere before they drive out of
 * range, and "it looked fine" is not good enough.
 */
function AccountBanner() {
  const { backend, session, pending, phase, lastSyncAt } = useSession();
  // Nothing truthful to say about an account that does not exist yet; the
  // first-run prompt covers that case instead.
  if (!backend) return <SignInPrompt />;

  if (!session) {
    return (
      <Link to="/access" className="card card-pad mb-4" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        <div className="spread">
          <span className="strong">Not signed in</span>
          <Pill tone="warn">Tap to sign in</Pill>
        </div>
        <p className="tiny muted mt-2">Working on this device only — nothing is shared with the crew.</p>
      </Link>
    );
  }

  const busy = phase === 'pushing' || phase === 'pulling';
  const tone = phase === 'error' ? 'danger' : pending > 0 || busy ? 'accent' : 'ok';

  return (
    <Link to="/access" className="card card-pad mb-4" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div className="spread">
        <span className="grow truncate">
          <span className="strong">{session.displayName}</span>
          <span className="muted"> · {ROLE_LABELS[session.role]}</span>
        </span>
        <Pill tone={tone}>
          {phase === 'error'
            ? 'Sync problem'
            : busy
              ? 'Syncing…'
              : pending > 0
                ? `${pending} waiting`
                : 'Synced'}
        </Pill>
      </div>
      <p className="tiny muted mt-2">
        {session.email ?? 'Joined by invite'}
        {lastSyncAt ? ` · last synced ${formatDateTime(lastSyncAt)}` : ' · not synced yet'}
      </p>
    </Link>
  );
}

/**
 * The screen the crew lands on. It answers the three questions asked most often
 * in the week before a race: what is next, how far through packing are we, and
 * what are we short of.
 */
export default function HomeScreen() {
  const navigate = useNavigate();
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
      return { destination, packlist, lines };
    },
    [stationOnly, session?.scope.destinationId],
  );

  const settings = useSettings();
  const events = useEvents();
  const items = useItems();
  const counted = useLiveQuery(() => countedItemIds(), [], new Set<string>());

  // The event to lead with: the next one that has not finished yet, otherwise
  // the most recent. Anything "live" jumps the queue.
  const focus = (() => {
    if (!events?.length) return undefined;
    const live = events.find((event) => event.status === 'live');
    if (live) return live;
    const upcoming = events
      .filter((event) => event.status !== 'closed' && daysUntil(event.endDate) >= 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return upcoming[0] ?? events[events.length - 1];
  })();

  const packlists = useLiveQuery(
    async () =>
      focus ? alive(await db.packlists.where('eventId').equals(focus.id).toArray()) : [],
    [focus?.id],
  );

  const packProgress = useLiveQuery(async () => {
    if (!packlists?.length) return null;
    const ids = new Set(packlists.map((packlist) => packlist.id));
    const lines = alive(await db.packlistLines.toArray()).filter((line) => ids.has(line.packlistId));
    const done = packlists.filter((packlist) => packlist.status !== 'draft' && packlist.status !== 'picking');
    return {
      lists: packlists.length,
      listsReady: done.length,
      lines: progressFor(lines),
    };
  }, [packlists]);

  const activeLoads = useLiveQuery(
    async () =>
      alive(await db.loads.toArray()).filter(
        (load) => load.status === 'in_transit' || load.status === 'delivering' || load.status === 'loading',
      ),
    [],
  );

  const openStocktakes = useLiveQuery(
    async () => alive(await db.stocktakes.toArray()).filter((entry) => entry.status === 'open'),
    [],
  );

  // A volunteer has one packlist and nothing else to do. Sending them through a
  // dashboard of races they cannot open is a lap of the app for no reason. The
  // branch sits below every hook so the order never changes between renders.
  if (stationOnly) return <StationHome station={station} />;

  // Without the counted set every shelf nobody has looked at yet reads as
  // "below reorder point" — 166 red alarms on a fresh catalogue, which is how
  // you teach someone to ignore the number. The stock screen already knew
  // this; the home screen did not.
  const low = items ? lowStockItems(items, counted) : [];
  const uncounted = items ? items.filter((item) => isUncounted(item, counted)).length : 0;
  // The signed-in account wins over the device's own crew name, which is left
  // over from offline-only mode and would otherwise greet you as someone else.
  const who = session?.displayName || settings?.crewName;
  const greeting = who ? `Gidday ${who.split(' ')[0]}` : 'Warehouse';

  return (
    <Screen title="SingleTrack Warehouse" subtitle={greeting}>
      {/* The logo artwork is white-on-transparent, so it sits on brand teal. */}
      <div className="brand-banner">
        <img src={logo} alt="SingleTrack Events" />
      </div>
      <AccountBanner />

      {/* Scanning is the fastest way in, so it gets the biggest button. */}
      <button type="button" className="btn btn-primary btn-lg btn-block mb-4" onClick={() => navigate('/scan')}>
        ⛶ Scan a crate or item
      </button>

      {focus ? (
        <section className="section">
          <div className="section-head">
            <h2>Next up</h2>
            <Link to="/events" className="small">
              All events
            </Link>
          </div>
          <Link to={`/events/${focus.id}`} className="card card-pad" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="spread mb-2">
              <div className="grow">
                <h3 style={{ fontSize: 'var(--text-xl)' }}>{focus.name}</h3>
                <p className="small muted mt-0">
                  {focus.location} · {formatDateRange(focus.startDate, focus.endDate)}
                </p>
              </div>
              <Pill tone={daysUntil(focus.startDate) <= 7 ? 'accent' : 'info'}>
                {relativeDays(focus.startDate)}
              </Pill>
            </div>

            {packProgress ? (
              <>
                <div className="spread small mb-2">
                  <span className="muted">
                    {packProgress.lines.linesDone} of {packProgress.lines.linesTotal} lines packed
                  </span>
                  <span className="strong">{packProgress.lines.percent}%</span>
                </div>
                <ProgressBar percent={packProgress.lines.percent} done={packProgress.lines.percent === 100} />
                <p className="tiny muted mt-2">
                  {plural(packProgress.listsReady, 'packlist')} of {packProgress.lists} ready to load
                  {packProgress.lines.blocking.length
                    ? ` · ${plural(packProgress.lines.blocking.length, 'must-have item')} still short`
                    : ''}
                </p>
              </>
            ) : (
              <p className="small muted">No packlists yet — open the event to build them.</p>
            )}
          </Link>
        </section>
      ) : (
        <EmptyState
          glyph="🏃"
          title="No events yet"
          body="Add your first race to start building packlists."
          action={
            <Link to="/events" className="btn btn-primary">
              Add an event
            </Link>
          }
        />
      )}

      {activeLoads?.length ? (
        <section className="section">
          <div className="section-head">
            <h2>On the road</h2>
          </div>
          <div className="list">
            {activeLoads.map((load) => (
              <Link key={load.id} to={`/transport/${load.id}`} className="row">
                <span className="row-icon">🚚</span>
                <span className="row-body">
                  <span className="row-title">{load.name}</span>
                  <span className="row-sub">
                    {load.driver || 'No driver'} · {load.vehicle || 'No vehicle'}
                  </span>
                </span>
                <Pill tone="info">{LOAD_STATUS_LABELS[load.status]}</Pill>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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

      <section className="section">
        <div className="section-head">
          <h2>Needs attention</h2>
        </div>
        <div className="stat-grid mb-3">
          <Link to="/stock?filter=low" className="stat" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="value" style={{ color: low.length ? 'var(--danger)' : 'var(--ok)' }}>
              {low.length}
            </div>
            <div className="label">Below reorder point</div>
          </Link>
          <div className="stat">
            <div className="value">{items?.length ?? '—'}</div>
            <div className="label">Items in catalogue</div>
          </div>
        </div>

        {/* Said out loud rather than folded into the low count: a shelf nobody
            has counted is not the same problem as a shelf that has run out. */}
        {uncounted ? (
          <p className="tiny muted mb-3">
            {uncounted} of them have never been counted, so the warehouse cannot vouch for what is
            on the shelf. <Link to="/stocktake">Run a stocktake</Link>
          </p>
        ) : null}

        {low.length ? (
          <div className="list">
            {low.slice(0, 5).map((item) => (
              <Link key={item.id} to={`/stock/${item.id}`} className="row">
                <span className="row-icon">⚠️</span>
                <span className="row-body">
                  <span className="row-title truncate">{item.name}</span>
                  <span className="row-sub">
                    {item.qtyOnHand} on hand · reorder at {item.minQty}
                  </span>
                </span>
                <span className="row-chevron">›</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="small muted">Everything is above its reorder point.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Jump to</h2>
        </div>
        <div className="list">
          <Link to="/stocktake" className="row">
            <span className="row-icon">🔢</span>
            <span className="row-body">
              <span className="row-title">Start a stocktake</span>
              <span className="row-sub">Count the racks, fix the numbers</span>
            </span>
            <span className="row-chevron">›</span>
          </Link>
          <Link to="/templates" className="row">
            <span className="row-icon">📋</span>
            <span className="row-body">
              <span className="row-title">Packlist templates</span>
              <span className="row-sub">Reusable patterns for each station type</span>
            </span>
            <span className="row-chevron">›</span>
          </Link>
          <Link to="/more" className="row">
            <span className="row-icon">💾</span>
            <span className="row-body">
              <span className="row-title">Backup &amp; handover</span>
              <span className="row-sub">Export a file for the driver</span>
            </span>
            <span className="row-chevron">›</span>
          </Link>
        </div>
      </section>
    </Screen>
  );
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
  station: { destination?: Destination; packlist?: Packlist; lines: PacklistLine[] } | undefined;
}) {
  const { session } = useSession();

  if (!station) {
    return (
      <Screen title="Your station">
        <p className="muted">Loading…</p>
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
          body="Your packlist has not reached this phone. It will appear once the warehouse has built it and the phone has signal."
        />
        <p className="tiny muted center mt-3">
          Signed in as {session?.displayName}. <Link to="/access">Account</Link>
        </p>
      </Screen>
    );
  }

  // What this station has confirmed, not what the warehouse packed: the number
  // on their home screen should be the one they can change.
  const progress = receiptFor(station.lines);

  return (
    <Screen title={name} subtitle={session ? `Signed in as ${session.displayName}` : undefined}>
      <div className="card card-pad mb-4">
        <div className="spread mb-2">
          <span className="strong">
            {progress.linesDone} / {progress.linesTotal} lines confirmed
          </span>
          <Pill tone={progress.percent === 100 ? 'ok' : 'accent'}>{progress.percent}%</Pill>
        </div>
        <ProgressBar percent={progress.percent} done={progress.percent === 100} />
        {station.destination?.accessNotes ? (
          <p className="tiny muted mt-2">🚙 {station.destination.accessNotes}</p>
        ) : null}
      </div>

      <Link className="btn btn-primary btn-lg btn-block" to={`/packlists/${station.packlist.id}`}>
        Open the packlist
      </Link>

      <p className="tiny muted center mt-4">
        Tick off each item as it turns up. What was meant to be sent is set by the warehouse, so a
        short delivery stays visible. <Link to="/access">Account</Link>
      </p>
    </Screen>
  );
}
