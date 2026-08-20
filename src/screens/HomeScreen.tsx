import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState, Pill, ProgressBar } from '../components/ui';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { useEvents, useItems, useSettings } from '../hooks/useDb';
import { lowStockItems } from '../domain/stock';
import { progressFor } from '../domain/packlists';
import { daysUntil, formatDateRange, plural, relativeDays } from '../domain/format';
import { LOAD_STATUS_LABELS } from '../domain/transport';

/**
 * The screen the crew lands on. It answers the three questions asked most often
 * in the week before a race: what is next, how far through packing are we, and
 * what are we short of.
 */
export default function HomeScreen() {
  const navigate = useNavigate();
  const settings = useSettings();
  const events = useEvents();
  const items = useItems();

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

  const low = items ? lowStockItems(items) : [];
  const greeting = settings?.crewName ? `Gidday ${settings.crewName.split(' ')[0]}` : 'Warehouse';

  return (
    <Screen title="SingleTrack Warehouse" subtitle={greeting}>
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
