import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Pill } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useCrewName, useEvent } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import { buyEverything, wantsFor, whatsMissing } from '../domain/missing';
import { overlappingStocktakes, startStocktake } from '../domain/stocktake';
import { DESTINATION_ICONS, formatQty, plural } from '../domain/format';
import type { Stocktake } from '../db/types';

/**
 * What's missing for an event.
 *
 * First-time crew could not find the answer to "what do we still need?"
 * because it was spread over the station lists, the warehouse list and the
 * food plan. This screen puts the three side by side, in plain words, with
 * one button to put everything to buy on the shopping list. Each part links
 * back to the screen where it gets fixed, so this is a place to start from,
 * not another place to do the work.
 */
export default function MissingScreen() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const crew = useCrewName();
  const { session } = useSession();
  const event = useEvent(eventId);
  const missing = useLiveQuery(async () => (eventId ? whatsMissing(eventId) : undefined), [eventId]);

  const [buying, setBuying] = useState(false);
  // Set before the first await, so a second tap in the same frame is turned
  // away too. The list would be right either way; this saves the second toast.
  const busy = useRef(false);
  const [countOpen, setCountOpen] = useState<Stocktake[]>();

  if (!event || !missing) {
    return (
      <Screen title="What's missing" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const canShop = can(session, 'shopping:manage', { eventId: event.id });
  const canCount = can(session, 'stocktake:manage');
  const wants = wantsFor(missing);
  const shortCount = missing.notPacked.reduce((sum, station) => sum + station.items.length, 0);
  const nothingAtAll =
    !missing.notPacked.length && !missing.warehouseShort.length && !missing.uncounted.length && !missing.food.length;

  const buyAll = async () => {
    if (busy.current) return;
    busy.current = true;
    setBuying(true);
    try {
      const result = await buyEverything(event.id, crew);
      const changed = result.added + result.updated;
      toast(
        changed
          ? `${plural(changed, 'item')} on the shopping list${result.added ? `, ${result.added} new` : ''}`
          : 'The shopping list already has all of this',
        changed ? 'ok' : 'warn',
      );
      navigate('/shopping');
    } catch {
      toast('Could not add to the shopping list. Try again.', 'error');
    } finally {
      busy.current = false;
      setBuying(false);
    }
  };

  /**
   * Count just the shelves nobody has counted. A stocktake of the whole
   * warehouse is a day's work; a dozen items is ten minutes, and it is what
   * stands between "unknown" and a real answer here.
   */
  const startCount = async (force = false) => {
    if (busy.current) return;
    if (!force) {
      const open = await overlappingStocktakes(null);
      if (open.length) {
        setCountOpen(open);
        return;
      }
    }
    busy.current = true;
    try {
      const stocktake = await startStocktake(`Count for ${event.name}`, {
        items: missing.uncounted.map((line) => line.item).filter((item) => item !== undefined),
        startedBy: crew,
      });
      toast(`Stocktake started for ${plural(missing.uncounted.length, 'item')}`);
      navigate(`/stocktake/${stocktake.id}`);
    } finally {
      busy.current = false;
    }
  };

  const doneWord = missing.truck ? 'on the truck' : 'packed';

  return (
    <Screen title="What's missing" subtitle={event.name} back={`/events/${event.id}`}>
      <p className="missing-intro">
        Everything this event still needs, in one place. Fix each part on its own screen, or put
        everything to buy on the shopping list at the bottom.
      </p>

      {nothingAtAll ? (
        <EmptyState
          glyph={missing.stations ? '🎉' : '⛺'}
          title={missing.stations ? 'Nothing missing' : 'No stations yet'}
          body={
            !missing.stations
              ? 'Add the stations on the event page and give each one a packing list. This page then shows what they still need.'
              : missing.noList.length
              ? 'Every packing list is done and nothing needs buying. Some stations have no packing list yet, so check those below.'
              : 'Every station is packed, the warehouse has enough of everything, and the food plan has nothing to buy.'
          }
        />
      ) : null}

      {/* ------------------------------------------------------- not packed */}
      <section className="section missing-section">
        <div className="section-head">
          <h2>Not packed yet</h2>
          {shortCount ? <Pill tone="warn">{plural(shortCount, 'item')}</Pill> : null}
        </div>
        {missing.truck ? (
          <p className="small muted mb-2">
            This event is packed onto a truck first, so &ldquo;packed&rdquo; here means on the truck.
          </p>
        ) : null}
        {missing.notPacked.length ? (
          missing.notPacked.map((station) => (
            <div key={station.destination.id} className="card mb-3">
              <Link to={`/packlists/${station.packlist.id}`} className="row missing-station">
                <span className="row-icon" aria-hidden>
                  {DESTINATION_ICONS[station.destination.type]}
                </span>
                <span className="row-body">
                  <span className="row-title">{station.destination.name}</span>
                  <span className="row-sub">
                    {plural(station.items.length, 'item')} still to pack. Open the packing list
                  </span>
                </span>
                <span className="row-chevron" aria-hidden>
                  ›
                </span>
              </Link>
              <div className="list">
                {station.items.map((entry) => (
                  <div key={entry.lineId} className="row row-static missing-row">
                    <span className="row-body">
                      <span className="row-title">{entry.item?.name ?? 'Unknown item'}</span>
                      <span className="row-sub">
                        {formatQty(entry.done, entry.item?.unit ?? 'each')} of{' '}
                        {formatQty(entry.needed, entry.item?.unit ?? 'each')} {doneWord}
                      </span>
                    </span>
                    <span className="row-end missing-qty">
                      {formatQty(entry.short, entry.item?.unit ?? 'each')} to go
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="card card-pad missing-empty">
            {!missing.stations
              ? 'No stations yet. Add them on the event page, then give each one a packing list.'
              : missing.noList.length
                ? 'Every packing list made so far is fully packed.'
                : 'Every station is fully packed.'}
          </p>
        )}
        {missing.noList.length ? (
          <p className="small muted mt-2">
            No packing list yet for {missing.noList.map((destination) => destination.name).join(', ')}. Add one
            from the{' '}
            <Link to={`/events/${event.id}`}>event page</Link> so you can see what they need.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------- warehouse */}
      <section className="section missing-section">
        <div className="section-head">
          <h2>Not enough in the warehouse</h2>
          {missing.warehouseShort.length ? <Pill tone="warn">{plural(missing.warehouseShort.length, 'item')}</Pill> : null}
        </div>
        {missing.warehouseShort.length ? (
          <div className="card list">
            {missing.warehouseShort.map((line) => (
              <Link key={line.itemId} to={`/stock/${line.itemId}`} className="row missing-row">
                <span className="row-body">
                  <span className="row-title">{line.item?.name ?? 'Unknown item'}</span>
                  <span className="row-sub">
                    Need {formatQty(line.qtyRequired, line.item?.unit ?? 'each')}, the warehouse has{' '}
                    {formatQty(line.qtyOnHand, line.item?.unit ?? 'each')}
                    {line.qtyFromStations
                      ? `. Another ${formatQty(line.qtyFromStations, line.item?.unit ?? 'each')} comes from other stations`
                      : ''}
                  </span>
                </span>
                <span className="row-end missing-qty">
                  {formatQty(line.shortfall, line.item?.unit ?? 'each')} short
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="card card-pad missing-empty">
            {missing.uncounted.length
              ? 'Nothing counted is short. Count the items below to be sure.'
              : 'The warehouse has enough of everything on the packing lists.'}
          </p>
        )}

        {missing.uncounted.length ? (
          <div className="card card-pad mt-3 missing-unknown">
            <p className="strong">Stock unknown: count these first</p>
            <p className="small muted mb-2">
              {plural(missing.uncounted.length, 'item')} on the packing lists{' '}
              {missing.uncounted.length === 1 ? 'has' : 'have'} never been counted, so the app cannot tell
              whether there are enough.
            </p>
            <ul className="missing-names small">
              {missing.uncounted.map((line) => (
                <li key={line.itemId}>
                  {line.item?.name ?? 'Unknown item'}: need {formatQty(line.qtyRequired, line.item?.unit ?? 'each')}
                </li>
              ))}
            </ul>
            {canCount ? (
              <button type="button" className="btn btn-outline btn-block mt-3" onClick={() => void startCount()}>
                🔢 Count {missing.uncounted.length === 1 ? 'this item' : `these ${missing.uncounted.length} items`} now
              </button>
            ) : (
              <p className="small muted mt-2">Ask someone who runs stocktakes to count them.</p>
            )}
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ food */}
      <section className="section missing-section">
        <div className="section-head">
          <h2>Food and drink to buy</h2>
          {missing.food.length ? <Pill tone="warn">{plural(missing.food.length, 'item')}</Pill> : null}
        </div>
        {missing.food.length ? (
          <div className="card list">
            {missing.food.map((total) => (
              <div key={total.item.id} className="row row-static missing-row">
                <span className="row-body">
                  <span className="row-title">{total.item.name}</span>
                  <span className="row-sub">
                    The plan needs {formatQty(total.total, total.item.unit)}, the warehouse has{' '}
                    {formatQty(total.onHand, total.item.unit)}
                  </span>
                </span>
                <span className="row-end missing-qty">buy {formatQty(total.toOrder, total.item.unit)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="card card-pad missing-empty">
            Nothing to buy for the food plan. If this event has aid stations with food, set it up in
            the <Link to={`/events/${event.id}/food`}>food plan</Link>.
          </p>
        )}
      </section>

      {wants.length && canShop ? (
        <div className="action-bar no-print">
          <button type="button" className="btn btn-primary btn-lg" disabled={buying} onClick={() => void buyAll()}>
            {buying ? 'Adding…' : `🛒 Put everything to buy on the shopping list (${wants.length})`}
          </button>
        </div>
      ) : null}

      {countOpen ? (
        <ConfirmSheet
          title="A stocktake is already open"
          body={
            <>
              {countOpen.map((stocktake) => stocktake.name).join(', ')} {countOpen.length === 1 ? 'is' : 'are'} still
              open. Counting the same shelf in two stocktakes at once can put the correction on twice. Finish
              that one from the <Link to="/stocktake">stocktake page</Link>, or start a small one just for these
              items anyway.
            </>
          }
          confirmLabel="Start anyway"
          onCancel={() => setCountOpen(undefined)}
          onConfirm={() => {
            setCountOpen(undefined);
            void startCount(true);
          }}
        />
      ) : null}
    </Screen>
  );
}
