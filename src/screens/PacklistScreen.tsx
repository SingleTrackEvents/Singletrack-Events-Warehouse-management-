import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { AssistantCheck } from '../components/AssistantCheck';
import { ItemPicker } from '../components/ItemPicker';
import { PackRuleSuggestions } from '../components/PackRuleSuggestions';
import { RunSheetCard } from '../components/RunSheetCard';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { MovePill } from '../components/Moves';
import { ConfirmSheet, Field, ProgressBar, Sheet, Stepper } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, byId, liveWhere, restore, softDelete, update } from '../db/repo';
import { useCategories, useCrewName, useEvent, usePacklist, usePacklistLines } from '../hooks/useDb';
import { moveInVan, resetVanOrder, unloadOrder } from '../domain/truck';
import { useSession } from '../hooks/sessionContext';
import { can, isStationOnly } from '../sync/permissions';
import { expectedHome, hasLeft, moveOf, moveState, sent, used } from '../domain/moves';
import { formatTime } from '../domain/format';
import {
  addLine,
  applyTemplate,
  clearConfirmations,
  clearNotes,
  hasIssued,
  isConfirmed,
  progressFor,
  receiptFor,
  received,
  removeLine,
  removePacklist,
  statusIndex,
  templateLineQty,
} from '../domain/packlists';
import { formatQty, plural } from '../domain/format';
import { categoryLabel, groupByCategory } from '../domain/grouping';
import { addShoppingLine, inputForItem } from '../domain/shopping';
import { isKit, kitLines } from '../domain/kits';
import type { PacklistLine, Template, TemplateLine, Unit } from '../db/types';

type Filter = 'todo' | 'all' | 'packed' | 'musthave';

/**
 * The jobs one list is worked through, in the order they happen.
 *
 * The shed packs it. The station checks it in off the van, counts what is
 * left of the food and drink at the end of the day, and ticks the gear back
 * into the van. The shed counts it in. Each job keeps its own number on the
 * line, so a short crate stays visible from whichever side you look at it.
 */
type Mode = 'pack' | 'arrived' | 'count' | 'packdown' | 'home';

const MODE_LABELS: Record<Mode, string> = {
  pack: '📦 Pack',
  arrived: '✅ Arrived',
  count: '🔢 Count',
  packdown: '🚐 Pack down',
  home: '🏠 Home',
};

/** How long a completed line stays on the "To pack" list before it goes. */
const LINGER_MS = 1000;

/** The same four filters, worded for each job. */
const FILTER_LABELS: Record<Mode, Record<Filter, string>> = {
  pack: { todo: 'To pack', all: 'All', packed: 'Packed', musthave: 'Must-have' },
  arrived: { todo: 'To check', all: 'All', packed: 'Confirmed', musthave: 'Must-have' },
  count: { todo: 'To count', all: 'All', packed: 'Counted', musthave: 'Must-have' },
  packdown: { todo: 'To pack down', all: 'All', packed: 'In the van', musthave: 'Must-have' },
  home: { todo: 'To count in', all: 'All', packed: 'Counted in', musthave: 'Must-have' },
};

function isMode(value: string | null): value is Mode {
  return value !== null && value in MODE_LABELS;
}

/**
 * Packing mode.
 *
 * Designed to be worked one-handed while the other hand holds a crate: rows are
 * full-width tap targets that toggle a line between nothing packed and fully
 * packed, with a stepper for the awkward in-between. Default filter is "to
 * pack" so the list shrinks as the crew works rather than making them hunt.
 */
export default function PacklistScreen() {
  const { packlistId } = useParams();
  const toast = useToast();
  const crew = useCrewName();
  const packlist = usePacklist(packlistId);
  const lines = usePacklistLines(packlistId);
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);
  const categories = useCategories();
  const destination = useLiveQuery(
    async () => (packlist ? db.destinations.get(packlist.destinationId) : undefined),
    [packlist?.destinationId],
  );

  const { session } = useSession();
  /*
   * Two views of one screen.
   *
   * The warehouse packs a crate; an aid station checks it in. They are not the
   * same job and must not write the same numbers — if the person at the station
   * could edit what was packed, a short delivery would vanish the moment they
   * ticked it off. So anyone without packing rights gets a confirm-only view,
   * recording what actually turned up against what the list says.
   */
  const canPack = can(session, 'packlist:pack');
  const canReceive = can(session, 'packlist:receive');
  const canManage = can(session, 'packlist:manage');
  const stationOnly = isStationOnly(session);
  const [searchParams] = useSearchParams();
  // The assistant bills a real account, so it wants a signed-in admin, not
  // the one-phone-on-its-own mode where every check passes for want of anyone
  // to check.
  const canAsk = Boolean(session) && can(session, 'assistant:use');

  const [filter, setFilter] = useState<Filter>('todo');
  const [picking, setPicking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingRequired, setEditingRequired] = useState<PacklistLine>();
  const [clearing, setClearing] = useState<'confirmations' | 'notes'>();
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  // Other lists for the same station. The event screen only ever opens one,
  // so a second list is otherwise invisible except as doubled totals.
  const siblings = useLiveQuery(
    async () =>
      packlist
        ? alive(await db.packlists.where('destinationId').equals(packlist.destinationId).toArray()).filter(
            (entry) => entry.id !== packlist.id,
          )
        : [],
    [packlist?.id, packlist?.destinationId],
  );
  // Kits whose contents are unfolded. A kit packs as one line; this is the
  // laminated list inside the lid, for whoever is filling the tubs.
  const [kitsOpen, setKitsOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleKit = (id: string) =>
    setKitsOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /*
   * A line that has just been completed stays on the "To pack" list for a beat.
   *
   * Without it the row vanishes the instant it goes green, which reads as the
   * row disappearing rather than as the tick registering — and leaves you
   * unsure whether you tapped the right one. A second is long enough to see the
   * check land and short enough not to be in the way.
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

  /*
   * Van order. A two-stage event opens its station lists this way: the crew
   * packing the van see load order (first in goes to the back), the station
   * checking it in sees unload order (what they need first, at the top).
   */
  const event = useEvent(packlist?.eventId);
  const truckStage = Boolean(event?.truckStage);
  // Where this list is, read from its lines rather than from a status button.
  const move = moveOf(lines ?? [], truckStage, packlist?.status);

  /*
   * Which job this screen is doing. The address can name one (the station's
   * home screen sends people straight to Count), otherwise the shed packs
   * until the list is at the station, and the station checks in until it is
   * time to pack down.
   */
  const modes = useMemo(() => {
    const available: Mode[] = [];
    if (canPack) available.push('pack');
    if (canReceive) available.push('arrived', 'count', 'packdown');
    if (canPack && (move === 'home' || (packlist && statusIndex(packlist.status) >= statusIndex('delivered')))) {
      available.push('home');
    }
    return available;
  }, [canPack, canReceive, move, packlist]);
  const [chosenMode, setChosenMode] = useState<Mode>();
  const asked = searchParams.get('mode');
  const mode: Mode = (() => {
    if (chosenMode && modes.includes(chosenMode)) return chosenMode;
    if (isMode(asked) && modes.includes(asked)) return asked;
    if (canPack && move !== 'station' && move !== 'home') return 'pack';
    if (move === 'home' && modes.includes('home')) return 'home';
    if (move === 'home' && modes.includes('packdown')) return 'packdown';
    return modes.includes('arrived') ? 'arrived' : modes[0] ?? 'pack';
  })();
  const returning = mode === 'home';
  // Who is writing the station's counts, for a station with more than one phone.
  const me = session?.displayName || crew;

  /** Whichever count this job keeps on the line. */
  const countOn = (line: PacklistLine): number => {
    switch (mode) {
      case 'pack':
        return line.qtyPacked;
      case 'arrived':
        return received(line);
      case 'count':
      case 'packdown':
        return line.qtyLeft ?? 0;
      case 'home':
        return line.qtyReturned;
    }
  };

  /** The number this job is working towards on the line. */
  const wantOn = (line: PacklistLine): number => {
    switch (mode) {
      case 'pack':
        return line.qtyRequired;
      case 'arrived':
      case 'packdown':
        return sent(line);
      case 'count':
        return received(line);
      case 'home':
        return expectedHome(line, Boolean(items?.get(line.itemId)?.consumable));
    }
  };

  /**
   * True when this job is finished with the line. Checking in is finished
   * once the station has said how many arrived, short or not: their job is
   * to say what turned up, and a short line must not keep it open forever.
   */
  const doneOn = (line: PacklistLine): boolean =>
    mode === 'count' || mode === 'packdown'
      ? hasLeft(line)
      : mode === 'arrived'
        ? isConfirmed(line)
        : countOn(line) >= wantOn(line);

  /** Only the lines this job is about: the food and drink to count, the gear to pack down. */
  const forMode = (line: PacklistLine): boolean => {
    if (mode === 'count') return Boolean(items?.get(line.itemId)?.consumable);
    if (mode === 'packdown') return !items?.get(line.itemId)?.consumable;
    return true;
  };

  /** Hold the row if this change is what completed the line. */
  const packTo = (line: PacklistLine, qty: number) => {
    const changes: Partial<PacklistLine> = (() => {
      switch (mode) {
        case 'pack':
          return { qtyPacked: qty };
        case 'arrived':
          return { qtyReceived: qty };
        case 'count':
        case 'packdown':
          return { qtyLeft: qty, countedBy: me };
        case 'home':
          return { qtyReturned: qty };
      }
    })();
    // Two phones at one station: a count somebody else already entered is
    // replaced, never silently.
    if ((mode === 'count' || mode === 'packdown') && hasLeft(line) && line.countedBy && line.countedBy !== me) {
      toast(`Replaced ${line.countedBy}'s count of ${line.qtyLeft}`, 'warn');
    }
    void update(db.packlistLines, line.id, changes);
    if (!doneOn(line) && (mode === 'count' || mode === 'packdown' || qty >= wantOn(line))) linger(line.id);
  };

  const progress = useMemo(() => {
    const mine = (lines ?? []).filter(forMode);
    const done = mine.filter(doneOn).length;
    const base = mode === 'pack' ? progressFor(mine) : receiptFor(mine);
    return {
      ...base,
      linesDone: done,
      linesTotal: mine.length,
      percent: mine.length ? Math.round((done / mine.length) * 100) : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, mode, items]);

  // What each reset would actually touch, so the offer can be honest about it
  // — and so a list with nothing to clear says so rather than pretending.
  const confirmedLines = (lines ?? []).filter(isConfirmed).length;
  const notedLines = (lines ?? []).filter((line) => line.note).length;

  const visible = useMemo(() => {
    const all = (lines ?? []).filter(forMode);
    if (filter === 'all') return all;
    if (filter === 'packed') return all.filter(doneOn);
    if (filter === 'musthave') return all.filter((line) => line.mandatory);
    return all.filter((line) => !doneOn(line) || lingering.has(line.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, filter, lingering, mode, items]);

  /*
   * Lines grouped under their item's category, in catalogue order, so a
   * 60-line load-out reads as Structure, then Power, then Food & Drink —
   * everything for the same corner of the truck in one place — rather than
   * whatever order the lines were added in.
   */
  const grouped = useMemo(
    () =>
      groupByCategory(
        visible,
        (line) => items?.get(line.itemId)?.categoryId ?? null,
        categories ?? [],
      ),
    [visible, items, categories],
  );

  const [view, setView] = useState<'category' | 'van'>();
  const vanView = view ? view === 'van' : Boolean(event?.truckStage);
  const loadView = mode === 'pack';
  const unloaded = useMemo(() => {
    const byId = new Map((categories ?? []).map((category) => [category.id, category]));
    return unloadOrder(lines ?? [], (line) => byId.get(items?.get(line.itemId)?.categoryId ?? ''));
  }, [lines, items, categories]);
  const vanLines = useMemo(() => {
    const order = loadView ? [...unloaded].reverse() : unloaded;
    const shown = new Set(visible.map((line) => line.id));
    return order.map((line, index) => ({ line, position: index + 1 })).filter(({ line }) => shown.has(line.id));
  }, [unloaded, visible, loadView]);
  const vanCustomised = unloaded.some((line) => line.vanOrder !== undefined && line.vanOrder !== null);

  if (!packlist) {
    return (
      <Screen title="Packlist" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  // The address names only the packlist, so the scope check has to wait until
  // the record is read. A list from another event or another aid station sends
  // the person home rather than opening: a shared phone, a stale link or a
  // seeded list is not a way past what the account was given.
  if (!can(session, 'packlist:read', { eventId: packlist.eventId, destinationId: packlist.destinationId })) {
    return <Navigate to="/" replace />;
  }

  // A deleted list is still in the database as a tombstone, so Back or an old
  // link would open it as if nothing happened. Off to the event instead.
  if (packlist.deletedAt) return <Navigate to={`/events/${packlist.eventId}`} replace />;

  /**
   * Tapping a row is all-or-nothing; the stepper handles partial counts.
   *
   * Counting food is never all-or-nothing, so there the row does nothing and
   * the number box is the control: a tap that quietly wrote "none left"
   * would be a tap that wrote the wrong number most of the time.
   */
  /** A swipe is deliberate, so the line goes at once, with Undo on the toast. */
  const removeWithUndo = (line: PacklistLine) => {
    void removeLine(line.id).then(() =>
      toast(`${items?.get(line.itemId)?.name ?? 'Line'} removed`, 'ok', {
        undo: () => restore(db.packlistLines, line.id),
      }),
    );
  };

  const toggleLine = (line: PacklistLine) => {
    if (mode === 'count') return;
    const full = doneOn(line) && countOn(line) >= wantOn(line);
    if (mode === 'packdown') {
      if (hasLeft(line)) void update(db.packlistLines, line.id, { qtyLeft: null, countedBy: me });
      else packTo(line, wantOn(line));
    } else if (mode === 'arrived' && isConfirmed(line)) {
      // Unticking a checked-in line takes the answer back to "not checked",
      // never to "none arrived": a mis-tap must not report a missing crate.
      const before = line.qtyReceived ?? null;
      void update(db.packlistLines, line.id, { qtyReceived: null });
      toast(`${items?.get(line.itemId)?.name ?? 'Line'} not checked yet`, 'ok', {
        undo: () => update(db.packlistLines, line.id, { qtyReceived: before }),
      });
    } else if (full) {
      // A gloved mis-tap on a packed row would wipe its count, so the way
      // back is one tap away rather than a recount.
      const before = countOn(line);
      packTo(line, 0);
      toast(`${items?.get(line.itemId)?.name ?? 'Line'} cleared`, 'ok', {
        undo: () => packTo(line, before),
      });
    } else {
      packTo(line, wantOn(line));
    }
    if (!full && navigator.vibrate) navigator.vibrate(15);
  };

  /**
   * One packlist line. In van order it also shows where it sits in the van,
   * and arrows for the crew to move it.
   */
  const renderLine = (
    line: PacklistLine,
    van?: { position: number; onUp?: () => void; onDown?: () => void },
  ) => {
            const item = items?.get(line.itemId);
            const unit = item?.unit ?? 'each';
            const count = countOn(line);
            // Checked in but fewer than were sent reads as short, not as done.
            const shortArrival = mode === 'arrived' && isConfirmed(line) && count < wantOn(line);
            const packed = doneOn(line) && !shortArrival;
            const short = shortArrival || (!doneOn(line) && (mode === 'count' || mode === 'packdown' ? false : count > 0));
            const kit = isKit(item);
            const counting = mode === 'count' || mode === 'packdown';
            const stamp =
              counting && hasLeft(line)
                ? `${line.countedBy ? `${line.countedBy} · ` : ''}${formatTime(line.updatedAt)}`
                : null;
            const row = (
              <>
              <div
                className={`pack-row${packed ? ' done' : short ? ' short' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => !returning && toggleLine(line)}
                onKeyDown={(event) => {
                  // Only the row's own keys: Enter in the number box (the
                  // phone's Go key, or a Bluetooth scanner) must not toggle it.
                  if (event.target !== event.currentTarget) return;
                  if (!returning && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    toggleLine(line);
                  }
                }}
              >
                {!returning && mode !== 'count' ? (
                  <span className="pack-check" aria-hidden>
                    ✓
                  </span>
                ) : null}
                {/* Place in the van, with the arrows to move it either side of
                    the number: out of the way of the name and its details. */}
                {van ? (
                  <span className="van-rail">
                    {van.onUp || van.onDown ? (
                      <button
                        type="button"
                        className="van-arrow"
                        aria-label="Move up"
                        disabled={!van.onUp}
                        onClick={(event) => {
                          // The row itself toggles packed; this only moves it.
                          event.stopPropagation();
                          van.onUp?.();
                        }}
                      >
                        ▲
                      </button>
                    ) : null}
                    <span className="van-pos">{van.position}</span>
                    {van.onUp || van.onDown ? (
                      <button
                        type="button"
                        className="van-arrow"
                        aria-label="Move down"
                        disabled={!van.onDown}
                        onClick={(event) => {
                          event.stopPropagation();
                          van.onDown?.();
                        }}
                      >
                        ▼
                      </button>
                    ) : null}
                  </span>
                ) : null}
                <span className="row-body">
                  <span className="row-title">
                    {item?.name ?? 'Unknown item'}
                    {line.mandatory ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
                  </span>
                  <span className="row-sub">
                    {item ? `${item.bin || 'no bin'} · ${item.sku}` : ''}
                    {line.note ? ` · ${line.note}` : ''}
                  </span>
                  {kit ? (
                    <button
                      type="button"
                      className="kit-toggle"
                      aria-expanded={kitsOpen.has(line.id)}
                      onClick={(event) => {
                        // The row itself toggles packed; this only unfolds the list.
                        event.stopPropagation();
                        toggleKit(line.id);
                      }}
                    >
                      📦 {kitsOpen.has(line.id) ? 'Hide' : 'What’s inside'} · {item?.contents?.length}
                    </button>
                  ) : null}
                  {/* The station's own numbers, where this job has them. */}
                  {counting && isConfirmed(line) ? (
                    <span className="row-sub">
                      Arrived {formatQty(received(line), unit)}
                      {mode === 'count' && used(line) !== null ? ` · used ${formatQty(used(line) as number, unit)}` : ''}
                    </span>
                  ) : counting ? (
                    <span className="row-sub">Sent {formatQty(sent(line), unit)} · not checked in</span>
                  ) : null}
                  {stamp ? <span className="row-sub">Counted {stamp}</span> : null}
                  {/* What the station counted, so a short delivery is visible
                      back at the warehouse rather than only recorded. */}
                  {mode === 'pack' && isConfirmed(line) ? (
                    <span
                      className="row-sub"
                      style={
                        received(line) < line.qtyPacked ? { color: 'var(--danger)' } : undefined
                      }
                    >
                      Station confirmed {formatQty(received(line), item?.unit ?? 'each')}
                      {received(line) < line.qtyPacked
                        ? ` of ${formatQty(line.qtyPacked, item?.unit ?? 'each')} sent`
                        : ''}
                    </span>
                  ) : null}
                </span>
                {returning ? (
                  <span className="row-end">
                    <div className="tiny muted mb-2">
                      Expect {formatQty(wantOn(line), unit)}
                    </div>
                    <Stepper
                      label="returned"
                      value={line.qtyReturned}
                      max={sent(line)}
                      onChange={(value) => void update(db.packlistLines, line.id, { qtyReturned: value })}
                    />
                  </span>
                ) : counting ? (
                  <span className="row-end">
                    <div className="tiny muted mb-2">{mode === 'count' ? 'left over' : 'back in the van'}</div>
                    <Stepper
                      label={mode === 'count' ? `left over ${item?.name ?? ''}` : `back in the van ${item?.name ?? ''}`}
                      value={hasLeft(line) ? (line.qtyLeft as number) : null}
                      placeholder="?"
                      max={mode === 'packdown' ? wantOn(line) : undefined}
                      onChange={(value) => packTo(line, value)}
                    />
                  </span>
                ) : (
                  <span className="row-end">
                    {canManage && mode === 'pack' ? (
                      <button
                        type="button"
                        className="pack-qty need-btn mb-2"
                        aria-label={`Change how many ${item?.name ?? 'items'} this stop needs`}
                        onClick={(event) => {
                          // The row itself toggles packed; this must not do both.
                          event.stopPropagation();
                          setEditingRequired(line);
                        }}
                      >
                        of {formatQty(wantOn(line), unit)}{' '}
                        <span aria-hidden>✎</span>
                      </button>
                    ) : (
                      <span className="pack-qty mb-2">
                        of {formatQty(wantOn(line), unit)}
                      </span>
                    )}
                    <Stepper
                      label={mode === 'pack' ? 'packed' : 'arrived'}
                      value={count}
                      onChange={(value) => packTo(line, value)}
                    />
                  </span>
                )}
              </div>
              {kit && kitsOpen.has(line.id) ? (
                <div className="kit-contents">
                  <div className="kit-contents-note">
                    Packing this line packs everything below
                    {line.qtyRequired > 1 ? ` — quantities are for ${line.qtyRequired} kits` : ''}.
                  </div>
                  {kitLines(item, items ?? new Map(), line.qtyRequired).map((inside) => (
                    <div key={inside.itemId} className="kit-line">
                      <span className="truncate">{inside.item?.name ?? 'Unknown item'}</span>
                      <span className="muted">× {inside.qty}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              </>
            );
            // Swiping a line off the list is the crew's job; a driver checking a
            // delivery in gets the plain row.
            return canManage && mode === 'pack' ? (
              <SwipeToDelete key={line.id} label="Remove" onDelete={() => removeWithUndo(line)}>
                {row}
              </SwipeToDelete>
            ) : (
              <div key={line.id}>{row}</div>
            );
  };

  return (
    <Screen
      title={packlist.name}
      subtitle={`${packlist.code} · ${moveState(move, truckStage)}`}
      back={stationOnly ? '/' : `/events/${packlist.eventId}`}
    >
      <div className="card card-pad mb-3">
        <div className="spread mb-2">
          <span className="strong">
            {progress.linesDone} / {progress.linesTotal}{' '}
            {mode === 'pack' ? 'lines' : mode === 'arrived' ? 'lines confirmed' : mode === 'count' ? 'counted' : mode === 'packdown' ? 'in the van' : 'counted in'}
          </span>
          <MovePill move={move} truckStage={truckStage} />
        </div>
        <ProgressBar percent={progress.percent} done={progress.percent === 100} />
        {(mode === 'pack' || mode === 'arrived') && progress.blocking.length ? (
          <p className="tiny mt-2" style={{ color: 'var(--danger)' }}>
            ⚠ {plural(progress.blocking.length, 'must-have item')}{' '}
            {mode === 'pack' ? 'still short' : 'not confirmed yet'}
          </p>
        ) : null}
        {mode === 'count' ? (
          <p className="tiny muted mt-2">
            End of day: how much of each is left. Used is worked out from what arrived. A box left
            empty means not counted yet.
          </p>
        ) : null}
        {mode === 'packdown' ? (
          <p className="tiny muted mt-2">
            Tap a line as it goes back in the van. The number is what came home from the station.
          </p>
        ) : null}
        {packlist.notes ? <p className="tiny muted mt-2">📝 {packlist.notes}</p> : null}
        {siblings?.length ? (
          <p className="tiny mt-2" style={{ color: 'var(--warn)' }}>
            ⚠ This station has {plural(siblings.length + 1, 'list')}:{' '}
            {siblings.map((entry, index) => (
              <span key={entry.id}>
                {index ? ', ' : ''}
                <Link to={`/packlists/${entry.id}`}>{entry.code}</Link>
              </span>
            ))}{' '}
            and this one. The warehouse list counts them all.
          </p>
        ) : null}
      </div>

      {/* The run sheet: open for the station's own crew, folded for the
          warehouse, who are here for the lines. */}
      {destination ? (
        stationOnly ? (
          <RunSheetCard destination={destination} />
        ) : (
          <details className="mb-3 no-print">
            <summary className="small strong">Run sheet: hours, crew lead, vehicle, access</summary>
            <div className="mt-2">
              <RunSheetCard destination={destination} />
            </div>
          </details>
        )
      ) : null}

      {modes.length > 1 ? (
        <div className="chip-row mb-3" role="group" aria-label="Job">
          {modes.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={mode === option}
              onClick={() => {
                setChosenMode(option);
                setFilter('todo');
              }}
            >
              {MODE_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chip-row mb-3">
        {(Object.keys(FILTER_LABELS.pack) as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {FILTER_LABELS[mode][option]}
          </button>
        ))}
      </div>

      {canManage && mode === 'pack' ? (
        <div className="btn-row mb-3 no-print">
          <button type="button" className="btn btn-outline" onClick={() => setPicking(true)}>
            + Add items
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setApplying(true)}>
            📋 Apply template
          </button>
          {canAsk ? (
            <button type="button" className="btn btn-outline" onClick={() => setChecking(true)}>
              ✨ Check this list
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="chip-row mb-3">
        <button type="button" className="chip" aria-pressed={!vanView} onClick={() => setView('category')}>
          By category
        </button>
        <button type="button" className="chip" aria-pressed={vanView} onClick={() => setView('van')}>
          🚐 Van order
        </button>
      </div>

      {vanView ? (
        <p className="tiny muted mb-3">
          {loadView
            ? 'Load order: pack from the top. Number 1 goes in first, at the back of the van, so what the station needs first comes out first.'
            : 'Unload order: what the station needs first is at the top.'}
          {canManage && !returning ? ' Use the arrows to move a line.' : ''}
          {canManage && vanCustomised ? (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => void resetVanOrder(lines ?? [])}>
                Back to the standard order
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {visible.length && vanView ? (
        <div className="list">
          {vanLines.map(({ line, position }) => {
            const total = unloaded.length;
            // Arrows move a line on screen; underneath that is a move in the
            // unload order, which runs the other way in the load view.
            const move = (onScreen: -1 | 1) =>
              void moveInVan(unloaded, line.id, (loadView ? -onScreen : onScreen) as -1 | 1);
            const movable = canManage && !returning;
            return renderLine(line, {
              position,
              onUp: movable && position > 1 ? () => move(-1) : undefined,
              onDown: movable && position < total ? () => move(1) : undefined,
            });
          })}
        </div>
      ) : visible.length ? (
        <div>
          {grouped.map(([categoryId, groupLines]) => {
            return (
              <section key={categoryId ?? 'uncategorised'} className="pack-group">
                {grouped.length > 1 ? (
                  <div className="pack-group-head">
                    {categoryLabel(categoryId, categories ?? [])}
                    <span className="muted"> · {groupLines.length}</span>
                  </div>
                ) : null}
                <div className="list">
                  {groupLines.map((line) => renderLine(line))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card card-pad center muted">
          {filter === 'todo' && progress.linesTotal
            ? mode === 'pack'
              ? '🎉 Everything on this list is packed.'
              : mode === 'arrived'
                ? '🎉 Everything is checked in.'
                : mode === 'count'
                  ? '🎉 Every line is counted.'
                  : mode === 'packdown'
                    ? '🎉 Everything is back in the van.'
                    : '🎉 Everything is counted in.'
            : mode === 'count'
              ? 'No food or drink on this list.'
              : 'Nothing here yet.'}
        </div>
      )}

      {/* Under the lines: the pack rules, while the list can still change before stock leaves. */}
      {canManage && mode === 'pack' && !hasIssued(packlist.status) && items ? (
        <PackRuleSuggestions
          packlistId={packlist.id}
          lines={lines ?? []}
          items={items}
          destinationType={destination?.type}
          eventId={packlist.eventId}
        />
      ) : null}

      <div className="btn-row mt-4 no-print">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotesOpen(true)}>
          📝 Notes
        </button>
        <Link className="btn btn-ghost btn-sm" to={`/packlists/${packlist.id}/print`}>
          🖨 Print run sheet
        </Link>
      </div>

      {canManage ? (
        <details className="card card-pad mt-3 no-print">
          <summary className="small strong">Start this list again, or delete it</summary>
          <p className="tiny muted mt-2">
            For a list confirmed against the wrong station, or a dry run somebody ticked through
            before the crates were real. What was required and what was packed are left alone.
          </p>
          <div className="btn-row mt-3">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!confirmedLines}
              onClick={() => setClearing('confirmations')}
            >
              Clear confirmations{confirmedLines ? ` (${confirmedLines})` : ''}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!notedLines && !packlist.notes}
              onClick={() => setClearing('notes')}
            >
              Clear notes{notedLines ? ` (${notedLines})` : ''}
            </button>
          </div>
          {!hasIssued(packlist.status) ? (
            <>
              <p className="tiny muted mt-3">
                For a second list this station should not have. Nothing has left the warehouse
                against it yet, so no stock moves.
              </p>
              <div className="btn-row mt-2">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setDeleting(true)}>
                  🗑 Delete this list
                </button>
              </div>
            </>
          ) : null}
        </details>
      ) : null}

      {picking ? (
        <ItemPicker
          title="Add to packlist"
          exclude={(lines ?? []).map((line) => line.itemId)}
          onClose={() => setPicking(false)}
          onPick={(picks) => {
            void (async () => {
              for (const pick of picks) await addLine(packlist.id, pick.item.id, pick.qty);
              const units = picks.reduce((sum, pick) => sum + pick.qty, 0);
              toast(`${plural(picks.length, 'item')} added · ${units} total`);
              setPicking(false);
            })();
          }}
        />
      ) : null}

      {checking && destination ? (
        <AssistantCheck
          packlist={packlist}
          destination={destination}
          lines={lines ?? []}
          items={items ?? new Map()}
          onClose={() => setChecking(false)}
        />
      ) : null}

      {applying ? (
        <ApplyTemplateSheet
          packlistId={packlist.id}
          onClose={() => setApplying(false)}
          onApplied={(name, undo) => {
            toast(`${name} applied`, 'ok', { undo });
            setApplying(false);
          }}
        />
      ) : null}

      {notesOpen ? (
        <NotesSheet
          initial={packlist.notes}
          onClose={() => setNotesOpen(false)}
          onSave={(notes) => {
            void update(db.packlists, packlist.id, { notes });
            setNotesOpen(false);
          }}
        />
      ) : null}

      {editingRequired ? (
        <RequiredSheet
          line={editingRequired}
          itemName={items?.get(editingRequired.itemId)?.name ?? 'this item'}
          unit={items?.get(editingRequired.itemId)?.unit ?? 'each'}
          onShop={
            can(session, 'shopping:manage', { eventId: packlist.eventId })
              ? (qty) => {
                  const item = items?.get(editingRequired.itemId);
                  if (!item) return;
                  void addShoppingLine(
                    inputForItem(item, qty, {
                      eventId: packlist.eventId,
                      source: 'packlist',
                      refId: packlist.id,
                      note: packlist.name,
                      by: crew,
                    }),
                  ).then(({ line, merged }) => {
                    toast(
                      merged
                        ? `Shopping list now says ${formatQty(line.qty, line.unit)} for ${item.name}`
                        : `${formatQty(qty, item.unit)} ${item.name} put on the shopping list`,
                    );
                    setEditingRequired(undefined);
                  });
                }
              : undefined
          }
          onClose={() => setEditingRequired(undefined)}
          onSave={(qtyRequired) => {
            void update(db.packlistLines, editingRequired.id, { qtyRequired }).then(() => {
              toast(`Now needs ${formatQty(qtyRequired, items?.get(editingRequired.itemId)?.unit ?? 'each')}`);
              setEditingRequired(undefined);
            });
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmSheet
          title={`Delete ${packlist.code}?`}
          body={
            <>
              {packlist.name} ({packlist.code}) and its {plural(lines?.length ?? 0, 'line')} will be
              deleted{progress.qtyPacked ? `, including ${plural(progress.qtyPacked, 'unit')} already packed` : ''}.
              There is no undo.
            </>
          }
          confirmLabel="Delete list"
          tone="danger"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            void removePacklist(packlist.id).then((done) => {
              toast(done ? `${packlist.code} deleted` : 'This list has been loaded and cannot be deleted');
              if (done) navigate(`/events/${packlist.eventId}`, { replace: true });
            });
          }}
        />
      ) : null}

      {clearing ? (
        <ConfirmSheet
          title={clearing === 'confirmations' ? 'Clear station confirmations?' : 'Clear notes?'}
          body={
            clearing === 'confirmations' ? (
              <>
                {plural(confirmedLines, 'line')} will go back to unconfirmed, so the aid station can
                count them again from scratch. What the warehouse packed is untouched.
              </>
            ) : (
              <>
                {packlist.notes && notedLines
                  ? `The note on this list and ${plural(notedLines, 'line note')}`
                  : packlist.notes
                    ? 'The note on this list'
                    : plural(notedLines, 'line note')}{' '}
                will be deleted. There is no undo.
              </>
            )
          }
          confirmLabel="Clear"
          tone="danger"
          onCancel={() => setClearing(undefined)}
          onConfirm={() => {
            const which = clearing;
            setClearing(undefined);
            void (async () => {
              if (which === 'confirmations') {
                const cleared = await clearConfirmations(packlist.id);
                toast(`${plural(cleared, 'confirmation')} cleared`);
              } else {
                const { list, lines: count } = await clearNotes(packlist.id);
                toast(`Cleared ${list ? 'the list note' : ''}${list && count ? ' and ' : ''}${
                  count ? plural(count, 'line note') : ''
                }`);
              }
            })();
          }}
        />
      ) : null}

    </Screen>
  );
}

/** What applying a template would do to a list, before anyone commits to it. */
function templatePreview(
  templateLines: TemplateLine[],
  existing: PacklistLine[],
  runners: number,
): { adds: number; topUps: number } {
  // Mirrors applyTemplate: an item already on the list is topped up, anything
  // else becomes a new line.
  const have = new Set(existing.map((line) => line.itemId));
  let adds = 0;
  let topUps = 0;
  for (const line of templateLines) {
    if (templateLineQty(line, runners) <= 0) continue;
    if (have.has(line.itemId)) topUps += 1;
    else adds += 1;
  }
  return { adds, topUps };
}

/**
 * Pick a template, see what it will do, then apply it.
 *
 * One tap used to merge a template straight in, and a whole-event list landed
 * ninety lines on one aid station. Now the tap shows how many lines it adds
 * and tops up first, the whole-event lists stay out of the way unless asked
 * for, and the toast carries an Undo that takes the new lines off and puts
 * the topped-up amounts back.
 */
function ApplyTemplateSheet({
  packlistId,
  onClose,
  onApplied,
}: {
  packlistId: string;
  onClose: () => void;
  onApplied: (name: string, undo: () => Promise<void>) => void;
}) {
  const templates = useLiveQuery(async () => alive(await db.templates.toArray()), []);
  const [runners, setRunners] = useState(0);
  const [showEvent, setShowEvent] = useState(false);
  const [chosen, setChosen] = useState<Template>();
  const applyingNow = useRef(false);
  const [busy, setBusy] = useState(false);

  const preview = useLiveQuery(async () => {
    if (!chosen) return undefined;
    const [templateLines, existing] = await Promise.all([
      liveWhere(db.templateLines, 'templateId', chosen.id),
      liveWhere(db.packlistLines, 'packlistId', packlistId),
    ]);
    return templatePreview(templateLines, existing, runners);
  }, [chosen?.id, packlistId, runners]);

  const wholeEvent = (templates ?? []).filter((template) => template.scope === 'event');
  const shown = (templates ?? []).filter((template) => showEvent || template.scope !== 'event');

  const apply = async (template: Template) => {
    if (applyingNow.current) return;
    applyingNow.current = true;
    setBusy(true);
    try {
      const before = new Map(
        (await liveWhere(db.packlistLines, 'packlistId', packlistId)).map((line) => [line.id, line]),
      );
      await applyTemplate(packlistId, template, runners);
      const after = await liveWhere(db.packlistLines, 'packlistId', packlistId);
      const added = after.filter((line) => !before.has(line.id));
      const topped = after.filter((line) => {
        const was = before.get(line.id);
        return was && (was.qtyRequired !== line.qtyRequired || was.mandatory !== line.mandatory);
      });
      const undo = async () => {
        for (const line of added) await softDelete(db.packlistLines, line.id);
        for (const line of topped) {
          const was = before.get(line.id)!;
          const now = await db.packlistLines.get(line.id);
          // Only put back what the template set. A line someone has changed
          // since keeps their number.
          if (!now || now.deletedAt || now.qtyRequired !== line.qtyRequired) continue;
          await update(db.packlistLines, line.id, { qtyRequired: was.qtyRequired, mandatory: was.mandatory });
        }
      };
      onApplied(template.name, undo);
    } finally {
      applyingNow.current = false;
      setBusy(false);
    }
  };

  if (chosen) {
    return (
      <Sheet
        title={`Apply ${chosen.name}?`}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setChosen(undefined)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !preview || !(preview.adds + preview.topUps)}
              onClick={() => void apply(chosen)}
            >
              {busy ? 'Applying…' : 'Apply'}
            </button>
          </>
        }
      >
        <p className="small">
          {!preview
            ? 'Working it out…'
            : !(preview.adds + preview.topUps)
              ? 'This template adds nothing to the list.'
              : [
                  preview.adds ? `Adds ${plural(preview.adds, 'new line')}` : '',
                  preview.topUps
                    ? `${preview.adds ? 'tops up' : 'Tops up'} ${plural(preview.topUps, 'line')} already on the list`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' and ') + '.'}
        </p>
        {chosen.scope === 'event' ? (
          <p className="small mt-2" style={{ color: 'var(--danger)' }}>
            This is a whole-event list, the totals for every station together, not one station&rsquo;s.
          </p>
        ) : null}
        <p className="tiny muted mt-2">You can undo it from the message that follows.</p>
      </Sheet>
    );
  }

  return (
    <Sheet title="Apply a template" onClose={onClose}>
      <p className="small muted mb-3">
        Template quantities are added to what is already on the list. The same item is topped up, not
        duplicated.
      </p>
      <Field label="Expected runners" hint="Used only by per-runner template lines.">
        {(id) => (
          <input
            id={id}
            className="input mb-3"
            inputMode="numeric"
            value={runners || ''}
            placeholder="0"
            onChange={(event) => setRunners(Number(event.target.value) || 0)}
          />
        )}
      </Field>
      <div className="list">
        {shown.map((template) => (
          <button
            key={template.id}
            type="button"
            className="row"
            onClick={() => setChosen(template)}
          >
            <span className="row-icon">📋</span>
            <span className="row-body">
              <span className="row-title">{template.name}</span>
              <span className="row-sub truncate">
                {template.scope === 'event' ? 'Whole event · ' : ''}
                {template.description}
              </span>
            </span>
            <span className="row-chevron">›</span>
          </button>
        ))}
      </div>
      {wholeEvent.length ? (
        <label className="checkbox mt-3">
          <input type="checkbox" checked={showEvent} onChange={(event) => setShowEvent(event.target.checked)} />
          <span>
            Show whole-event lists too
            <span className="small muted" style={{ display: 'block' }}>
              {plural(wholeEvent.length, 'list')} with the totals for every station, not one.
            </span>
          </span>
        </label>
      ) : null}
    </Sheet>
  );
}

function NotesSheet({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (notes: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Sheet
      title="Packlist notes"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(value)}>
            Save
          </button>
        </>
      }
    >
      <textarea
        className="textarea"
        style={{ minHeight: 160 }}
        autoFocus
        value={value}
        placeholder="Extra water for the plateau, chairs stay in the truck…"
        onChange={(event) => setValue(event.target.value)}
      />
    </Sheet>
  );
}

/**
 * Change how many of an item a stop needs.
 *
 * The template is a starting point, not a rule — a station that draws more
 * runners than the pattern assumed needs six water containers where the
 * template said four, and the crew has to be able to say so while standing in
 * front of the crate. Reached by tapping the "of 4" on the line.
 *
 * This edits the requirement for this stop only. The template behind it is
 * untouched, so one busy aid station does not quietly re-plan the whole race.
 */
function RequiredSheet({
  line,
  itemName,
  unit,
  onShop,
  onClose,
  onSave,
}: {
  line: PacklistLine;
  itemName: string;
  unit: Unit;
  /** Put the shortfall on the shopping list. Absent when this account cannot. */
  onShop?: (qty: number) => void;
  onClose: () => void;
  onSave: (qtyRequired: number) => void;
}) {
  const [qty, setQty] = useState(line.qtyRequired);
  // What the shelf could not supply: the requirement less what is in the crate.
  const missing = Math.max(0, qty - line.qtyPacked);

  return (
    <Sheet
      title={`How many does this stop need?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(qty)}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small">
          <span className="strong">{itemName}</span>
        </p>
        <div className="center">
          <Stepper label={`required ${itemName}`} value={qty} min={1} onChange={setQty} />
        </div>
        {/*
          Increments rather than bare numbers: "+2" says what it does, where a
          chip reading "6" next to a stepper showing 4 is a puzzle.
        */}
        <div className="chip-row-inline">
          {[1, 2, 5, 10].map((step) => (
            <button
              key={step}
              type="button"
              className="chip"
              onClick={() => setQty((current) => current + step)}
            >
              +{step}
            </button>
          ))}
          {qty !== line.qtyRequired ? (
            <button type="button" className="chip" onClick={() => setQty(line.qtyRequired)}>
              Back to {line.qtyRequired}
            </button>
          ) : null}
        </div>
        <p className="tiny muted">
          Changes this stop only — the template it came from is left alone, so one busy station does
          not re-plan the rest of the race.
        </p>
        {line.qtyPacked > qty ? (
          <p className="tiny" style={{ color: 'var(--warn)' }}>
            {formatQty(line.qtyPacked, unit)} already packed, which is more than this. The extra
            stays in the crate — nothing is taken out.
          </p>
        ) : null}
        {onShop && missing > 0 ? (
          <div className="card card-pad">
            <p className="small strong">Nothing left on the shelf?</p>
            <p className="tiny muted mb-2">
              Put the {formatQty(missing, unit)} still to pack on the shopping list for this event.
              The line here is left as it is.
            </p>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onShop(missing)}>
              🛒 Add {formatQty(missing, unit)} to the shopping list
            </button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
