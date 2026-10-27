import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Screen } from '../App';
import { ShoppingLineSheet } from '../components/ShoppingLineSheet';
import type { ShoppingDraft } from '../components/ShoppingLineSheet';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { ConfirmSheet, EmptyState, Pill } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { byId, restore, softDelete, update } from '../db/repo';
import { useCrewName, useEvents, useItems, useShoppingLines } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import {
  addShoppingLine,
  awaitingBooking,
  bookAllBought,
  bookLine,
  bought,
  canonicalShop,
  clearBought,
  describeLine,
  groupByShop,
  isBooked,
  isBought,
  markBought,
  shoppingCsv,
  shoppingText,
  shopsUsed,
  toBuy,
} from '../domain/shopping';
import { downloadCsv } from '../domain/backup';
import { formatQty, localIsoDate, plural } from '../domain/format';
import type { ShoppingLine } from '../db/types';

type Filter = 'todo' | 'bought' | 'all';

/**
 * True where sharing should open the phone's share sheet: the browser has
 * one and the screen is touched rather than clicked. Read once, since neither
 * changes while the list is open.
 */
const shareSheet =
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

/**
 * Put text on the clipboard. The modern way needs a secure page and
 * permission; the old way still works on the plain http address the
 * warehouse laptop sometimes uses. False when neither did.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused; try the old way below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/** How long a just-bought line stays on the "To buy" list before it goes. */
const LINGER_MS = 1000;

const FILTER_LABELS: Record<Filter, string> = {
  todo: 'To buy',
  bought: 'Bought',
  all: 'All',
};

/**
 * The shopping list, worked one shop at a time.
 *
 * Built like packing mode, because it is used the same way: one hand on a
 * trolley, the other on the phone. Rows are full-width tap targets that tick
 * a line off; the list opens on what is left to buy so it shrinks as the trip
 * goes on. Once home, one tap books everything bought into stock, and the
 * low-stock alarms clear themselves.
 */
export default function ShoppingScreen() {
  const toast = useToast();
  const crew = useCrewName();
  const { session } = useSession();
  const lines = useShoppingLines();
  const events = useEvents();
  const items = useItems();

  const [filter, setFilter] = useState<Filter>('todo');
  const [forFilter, setForFilter] = useState<string>('');
  const [editing, setEditing] = useState<'new' | ShoppingLine>();
  const [clearing, setClearing] = useState(false);
  const [booking, setBooking] = useState(false);

  /*
   * A line just ticked off stays on the "To buy" list for a beat, as on a
   * packlist: without it the row vanishes the instant it goes green, which
   * reads as the row disappearing rather than the tick landing, and in a busy
   * aisle that is a second look to check the right thing was ticked.
   */
  const [lingering, setLingering] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const linger = (id: string) => {
    clearTimeout(timers.current.get(id));
    setLingering((current) => new Set(current).add(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setLingering((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, LINGER_MS),
    );
  };

  const itemById = useMemo(() => byId(items ?? []), [items]);
  const eventName = (eventId: string | null) =>
    eventId ? events?.find((event) => event.id === eventId)?.name : undefined;

  const all = useMemo(() => lines ?? [], [lines]);
  const open = toBuy(all);
  const done = bought(all);
  // An archived item is out of use: its purchase is not booked onto the shelf
  // count, so it is not offered as waiting either.
  const isArchived = (line: ShoppingLine) => Boolean(line.itemId && itemById.get(line.itemId)?.archived);
  const waiting = awaitingBooking(all).filter((line) => !isArchived(line));
  // Lines with a booking on its way, so a double tap on Book in is one tap.
  const bookingNow = useRef(new Set<string>());
  const shops = useMemo(() => shopsUsed(all), [all]);

  // The "for" filter only earns its place once the list spans more than one
  // event or the warehouse; a list for one race has nothing to narrow.
  const targets = useMemo(() => {
    const seen = new Set(all.map((line) => line.eventId ?? ''));
    return [...seen];
  }, [all]);

  const visible = useMemo(() => {
    const base =
      filter === 'todo'
        ? all.filter((line) => !line.boughtAt || lingering.has(line.id))
        : filter === 'bought'
          ? done
          : all;
    if (!forFilter) return base;
    return base.filter((line) => (line.eventId ?? '') === (forFilter === 'warehouse' ? '' : forFilter));
  }, [filter, forFilter, done, all, lingering]);

  const grouped = useMemo(() => groupByShop(visible), [visible]);

  if (!can(session, 'shopping:manage')) return <Navigate to="/" replace />;

  const toggle = (line: ShoppingLine) => {
    if (isBooked(line)) {
      toast('Already booked into stock. Adjust the item if the count is wrong.', 'warn');
      return;
    }
    const buying = !isBought(line);
    void markBought(line.id, crew, buying);
    if (buying) {
      linger(line.id);
      if (navigator.vibrate) navigator.vibrate(15);
    }
  };

  const save = (draft: ShoppingDraft) => {
    if (editing === 'new') {
      void addShoppingLine({ ...draft, by: crew }).then(({ merged, line }) => {
        toast(merged ? `${line.name} topped up to ${formatQty(line.qty, line.unit)}` : `${line.name} added`);
      });
    } else if (editing) {
      // Spelt the way the rest of the list spells the shop, so it joins that group.
      const others = all.filter((line) => line.id !== editing.id);
      void update(db.shoppingLines, editing.id, { ...draft, shop: canonicalShop(draft.shop, others) }).then(() =>
        toast('Item updated'),
      );
    }
    setEditing(undefined);
  };

  /**
   * Hand the list to whoever is at the shop. On a phone that is the share
   * sheet. A laptop browser often has no share sheet, or one that opens a
   * dialog nobody expects, so there the list is copied for pasting into an
   * email or a message, and the toast says so. A share cancelled on purpose
   * is left at that rather than quietly copied as well.
   */
  const share = async () => {
    const text = shoppingText(visible, eventName);
    if (shareSheet) {
      try {
        await navigator.share({ title: 'Shopping list', text });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // The share sheet refused; copying still gets the list out.
      }
    }
    if (await copyText(text)) toast('List copied. Paste it into an email or a message.');
    else toast('Could not copy from this browser. Try Print or CSV instead.', 'error');
  };

  const remove = (line: ShoppingLine) => {
    void softDelete(db.shoppingLines, line.id).then(() =>
      toast(`${line.name} off the list`, 'ok', {
        undo: () => restore(db.shoppingLines, line.id),
      }),
    );
  };

  const exportCsv = () => {
    downloadCsv(
      shoppingCsv(visible, eventName, (itemId) => (itemId ? itemById.get(itemId)?.sku ?? '' : '')),
      `shopping-list-${localIsoDate()}.csv`,
    );
    toast('Shopping list saved to downloads');
  };

  const bookAll = async () => {
    setBooking(true);
    const count = await bookAllBought(all, crew);
    setBooking(false);
    const archived = awaitingBooking(all).filter(isArchived).length;
    const skipped = archived ? `. ${plural(archived, 'archived item')} left out` : '';
    toast(
      count ? `${plural(count, 'item')} booked into stock${skipped}` : `Nothing to book in${skipped}`,
      count && !archived ? 'ok' : 'warn',
    );
  };

  const bookOne = (line: ShoppingLine) => {
    if (bookingNow.current.has(line.id)) return;
    bookingNow.current.add(line.id);
    void bookLine(line.id, crew)
      .then((result) => {
        if (result.status === 'booked') {
          toast(
            result.resolved
              ? `${line.name} booked into stock and off the low-stock list`
              : `${line.name} booked into stock`,
          );
        } else if (result.status === 'already') {
          toast(`${line.name} is already booked in`);
        } else if (result.status === 'archived') {
          toast(`${line.name} is archived, so it was not booked in. Bring the item back first.`, 'warn');
        } else {
          toast('Could not book that in', 'warn');
        }
      })
      .finally(() => bookingNow.current.delete(line.id));
  };

  return (
    <Screen
      title="Shopping list"
      subtitle={lines ? (open.length ? `${plural(open.length, 'item')} to buy` : 'Nothing to buy') : undefined}
      back="-1"
      actions={
        <button type="button" className="header-btn" aria-label="Add an item" onClick={() => setEditing('new')}>
          +
        </button>
      }
    >
      <h2 className="print-only mb-3">Shopping list</h2>
      <div className="chip-row mb-3 no-print">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {FILTER_LABELS[option]}
            {option === 'todo' && open.length ? ` · ${open.length}` : ''}
            {option === 'bought' && done.length ? ` · ${done.length}` : ''}
          </button>
        ))}
      </div>

      {targets.length > 1 ? (
        <select
          className="select mb-3 no-print"
          aria-label="Show lines for"
          value={forFilter}
          onChange={(event) => setForFilter(event.target.value)}
        >
          <option value="">Everything</option>
          {targets.includes('') ? <option value="warehouse">Warehouse restock</option> : null}
          {(events ?? [])
            .filter((event) => targets.includes(event.id))
            .map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
        </select>
      ) : null}

      {lines && !all.length ? (
        <EmptyState
          glyph="🛒"
          title="Nothing on the list"
          body="Add something to buy here, or send the food plan's shortfalls and the warehouse's low stock across from their own screens."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              Add an item
            </button>
          }
        />
      ) : null}

      {all.length && !visible.length ? (
        <div className="card card-pad center muted">
          {filter === 'todo' ? '🎉 Everything on the list is bought.' : 'Nothing here.'}
        </div>
      ) : null}

      {grouped.map(([shop, group]) => (
        <section key={shop || 'anywhere'} className="pack-group">
          {grouped.length > 1 || shop ? (
            <div className="pack-group-head">
              {shop ? `🏬 ${shop}` : '🛒 Anywhere'}
              <span className="muted"> · {group.length}</span>
            </div>
          ) : null}
          <div className="list">
            {group.map((line) => {
              const item = line.itemId ? itemById.get(line.itemId) : undefined;
              const ticked = isBought(line);
              const row = (
                <div
                  className={`pack-row${ticked ? ' done' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={ticked}
                  onClick={() => toggle(line)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(line);
                    }
                  }}
                >
                  <span className="pack-check" aria-hidden>
                    ✓
                  </span>
                  <span className="row-body">
                    <span className="row-title">{line.name}</span>
                    <span className="row-sub">{describeLine(line, eventName(line.eventId))}</span>
                    {item ? (
                      <span className="row-sub">
                        {formatQty(item.qtyOnHand, item.unit)} on hand
                        {item.bin ? ` · ${item.bin}` : ''}
                      </span>
                    ) : null}
                    {ticked ? (
                      <span className="row-sub">
                        {isBooked(line) ? (
                          <Pill tone="ok">Booked into stock</Pill>
                        ) : isArchived(line) ? (
                          <Pill tone="warn">Bought · item archived, not booked in</Pill>
                        ) : line.itemId ? (
                          <Pill tone="info">Bought · not booked in yet</Pill>
                        ) : (
                          <Pill tone="ok">Bought</Pill>
                        )}
                        {line.boughtBy ? ` by ${line.boughtBy}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="row-end">
                    {/* A mouse cannot swipe, so a computer gets a plain button. */}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm pointer-only no-print"
                      aria-label={`Take ${line.name} off the list`}
                      onClick={(event) => {
                        event.stopPropagation();
                        remove(line);
                      }}
                    >
                      ✕
                    </button>
                    {!ticked ? (
                      <button
                        type="button"
                        className="pack-qty need-btn"
                        aria-label={`Change ${line.name}`}
                        onClick={(event) => {
                          // The row itself ticks the line; this must not do both.
                          event.stopPropagation();
                          setEditing(line);
                        }}
                      >
                        {formatQty(line.qty, line.unit)} <span aria-hidden>✎</span>
                      </button>
                    ) : line.itemId && !isBooked(line) && isArchived(line) ? (
                      <Pill tone="warn">Archived item</Pill>
                    ) : line.itemId && !isBooked(line) ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          bookOne(line);
                        }}
                      >
                        Book in
                      </button>
                    ) : (
                      <span className="pack-qty muted">{formatQty(line.qty, line.unit)}</span>
                    )}
                  </span>
                </div>
              );
              return (
                <SwipeToDelete key={line.id} label="Remove" onDelete={() => remove(line)}>
                  {row}
                </SwipeToDelete>
              );
            })}
          </div>
        </section>
      ))}

      {visible.length ? (
        <div className="btn-row mt-3 no-print">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void share()}>
            {shareSheet ? '↗ Share' : '⧉ Copy list'}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()}>
            🖨 Print
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv}>
            ⬇ CSV
          </button>
          {done.length ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClearing(true)}>
              Clear bought ({done.length})
            </button>
          ) : null}
        </div>
      ) : null}

      {all.length ? (
        <p className="tiny muted mt-3 no-print">
          Tap an item to tick it off in the shop.{' '}
          <span className="touch-only">Swipe an item left to take it off the list. </span>
          <span className="pointer-only">Use ✕ to take an item off the list. </span>
          Bought catalogue items are booked into stock from here, so the low-stock alarm clears on
          its own.
        </p>
      ) : null}

      {waiting.length ? (
        <div className="action-bar no-print">
          <button type="button" className="btn btn-primary btn-lg" disabled={booking} onClick={() => void bookAll()}>
            {booking ? 'Booking in…' : `Book ${plural(waiting.length, 'bought item')} into stock`}
          </button>
        </div>
      ) : null}

      {editing ? (
        <ShoppingLineSheet
          initial={editing === 'new' ? undefined : editing}
          shops={shops}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      ) : null}

      {clearing ? (
        <ConfirmSheet
          title={`Clear ${plural(done.length, 'bought item')}?`}
          body={
            waiting.length
              ? `${plural(waiting.length, 'item')} bought but not booked into stock yet. Clearing them now means the purchase never reaches the ledger. Book them in first if that stock is on the shelf.`
              : 'They come off the list. Anything already booked into stock stays there.'
          }
          confirmLabel="Clear"
          tone="danger"
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            setClearing(false);
            void clearBought(all).then((count) => toast(`${plural(count, 'item')} cleared`));
          }}
        />
      ) : null}
    </Screen>
  );
}
