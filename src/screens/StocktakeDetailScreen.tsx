import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, Pill, ProgressBar } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSearch } from '../hooks/useSearch';
import { db } from '../db/db';
import { alive, byId, liveWhere } from '../db/repo';
import { useCrewName } from '../hooks/useDb';
import {
  cancelStocktake,
  compareShelves,
  completeStocktake,
  countProblem,
  deltaFor,
  isSurprisingCount,
  recordCount,
  setCountNote,
  setShelf,
  summarise,
  tidyShelf,
  variances,
} from '../domain/stocktake';
import { downloadCsv, slugify } from '../domain/backup';
import { formatQty, plural } from '../domain/format';
import type { Item, StocktakeCount } from '../db/types';

type Filter = 'todo' | 'all' | 'counted' | 'variance';

const FILTER_LABELS: Record<Filter, string> = {
  todo: 'To count',
  all: 'All',
  counted: 'Counted',
  variance: 'Discrepancies',
};

/** Which list is showing and when this pass began. See `pass` below. */
interface View {
  id: string;
  filter: Filter;
  since: string;
}

const viewKey = (id: string) => `stocktake:view:${id}`;
const shelfKey = (id: string) => `stocktake:last-shelf:${id}`;

/*
 * Browser storage can be missing or refuse (a private window, a locked-down
 * phone). Every read and write here is a convenience, so a failure just means
 * starting fresh.
 */
function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Nothing to do: the screen works the same, it just forgets on the way out.
  }
}

/**
 * The view to open on: the one left on the way out, if any.
 *
 * Without this, nipping back to the item page and returning started a new
 * pass, and every row counted so far dropped off "To count" at once.
 */
function openingView(id: string): View {
  const raw = readStored(viewKey(id));
  if (raw) {
    try {
      const stored = JSON.parse(raw) as Partial<View>;
      if (stored.filter && stored.filter in FILTER_LABELS && typeof stored.since === 'string') {
        return { id, filter: stored.filter, since: stored.since };
      }
    } catch {
      // A garbled entry is no worse than none.
    }
  }
  const fresh: View = { id, filter: 'todo', since: new Date().toISOString() };
  writeStored(viewKey(id), JSON.stringify(fresh));
  return fresh;
}

/**
 * Counting screen.
 *
 * Same shape as packing: default to what is still outstanding so the list gets
 * shorter as you walk the racks, and keep the number entry under the thumb.
 */
export default function StocktakeDetailScreen() {
  const { stocktakeId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const crew = useCrewName();

  const stocktake = useLiveQuery(
    async () => (stocktakeId ? db.stocktakes.get(stocktakeId) : undefined),
    [stocktakeId],
  );
  const counts = useLiveQuery(
    async () => (stocktakeId ? liveWhere(db.stocktakeCounts, 'stocktakeId', stocktakeId) : []),
    [stocktakeId],
  );
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);

  const [query, setQuery] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [checking, setChecking] = useState<{ count: StocktakeCount; value: number }>();
  const [lastShelf, setLastShelf] = useState(() => readStored(shelfKey(stocktakeId ?? '')) ?? '');

  const summary = useMemo(() => summarise(counts ?? []), [counts]);
  const discrepancies = useMemo(
    () => (counts && items ? variances(counts, items) : []),
    [counts, items],
  );

  /*
   * Rows counted during this pass stay on the "To count" list.
   *
   * Otherwise a row vanishes from under the thumb the instant the first number
   * lands, which makes correcting a miskey impossible and reads as the app
   * counting the line before you were finished with it.
   *
   * "This pass" is a timestamp rather than a set of ids, so it needs no
   * bookkeeping as rows are counted: a line counted after the list was built is
   * still yours to adjust. Re-applying the filter starts a new pass and the
   * list shortens to what genuinely remains. The pass is kept for the session,
   * so leaving the screen and coming back carries on where you were.
   */
  const [view, setView] = useState<View>(() => openingView(stocktakeId ?? ''));
  if (view.id !== (stocktakeId ?? '')) setView(openingView(stocktakeId ?? ''));
  const filter = view.filter;

  const chooseFilter = (option: Filter) => {
    const next: View = { id: stocktakeId ?? '', filter: option, since: new Date().toISOString() };
    setView(next);
    writeStored(viewKey(next.id), JSON.stringify(next));
  };

  const filtered = useMemo(() => {
    const all = counts ?? [];
    if (filter === 'all') return all;
    if (filter === 'counted') return all.filter((count) => count.counted !== null);
    if (filter === 'variance') return all.filter((count) => count.counted !== null && deltaFor(count) !== 0);
    return all.filter(
      (count) => count.counted === null || (count.countedAt !== null && count.countedAt >= view.since),
    );
  }, [counts, filter, view.since]);

  const searched = useSearch(filtered, query, (count) => {
    const item = items?.get(count.itemId);
    return [item?.name ?? '', item?.sku ?? '', item?.bin ?? ''];
  });

  // Counting in shelf order beats alphabetical: you walk the racks, not the A to Z.
  const ordered = useMemo(
    () =>
      [...searched].sort((a, b) => {
        const left = items?.get(a.itemId);
        const right = items?.get(b.itemId);
        return compareShelves(left?.bin, right?.bin) || (left?.name ?? '').localeCompare(right?.name ?? '');
      }),
    [searched, items],
  );

  // Put the list back where it was left, once there is a list to scroll.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !ordered.length) return;
    restored.current = true;
    const saved = Number(readStored(`${viewKey(stocktakeId ?? '')}:scroll`));
    if (saved > 0) window.scrollTo(0, saved);
  }, [ordered.length, stocktakeId]);
  useEffect(() => {
    const key = `${viewKey(stocktakeId ?? '')}:scroll`;
    return () => writeStored(key, String(Math.round(window.scrollY)));
  }, [stocktakeId]);

  if (!stocktake) {
    return (
      <Screen title="Stocktake" back="/stocktake">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const open = stocktake.status === 'open';

  const refused = (error: unknown) =>
    toast(error instanceof Error ? error.message : 'Could not save that', 'warn');

  const save = (count: StocktakeCount, value: number | null) =>
    void recordCount(count.id, value, { by: crew }).catch(refused);

  // Negative and absurd figures are stopped here with a reason, rather than
  // quietly clamped to something nobody typed.
  const commit = (count: StocktakeCount, value: number) => {
    const problem = countProblem(value);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    if (isSurprisingCount(value)) {
      setChecking({ count, value });
      return;
    }
    save(count, value);
  };

  const fileOnShelf = (count: StocktakeCount, shelf: string) =>
    void setShelf(count.id, shelf)
      .then((stored) => {
        if (!stored) return;
        setLastShelf(stored);
        writeStored(shelfKey(stocktake.id), stored);
      })
      .catch(refused);

  const exportCsv = () => {
    const rows: string[][] = [
      ['Item', 'SKU', 'Bin', 'Expected', 'Counted', 'Difference', 'Counted by', 'Note'],
      ...(counts ?? []).map((count) => {
        const item = items?.get(count.itemId);
        return [
          item?.name ?? '',
          item?.sku ?? '',
          item?.bin ?? '',
          String(count.expected),
          count.counted === null ? '' : String(count.counted),
          count.counted === null ? '' : String(deltaFor(count)),
          count.countedBy,
          count.note,
        ];
      }),
    ];
    downloadCsv(rows, `${slugify(stocktake.name)}.csv`);
    toast('CSV saved to downloads');
  };

  const subtitle = open ? 'Counting' : stocktake.status === 'cancelled' ? 'Cancelled' : 'Completed';

  return (
    <Screen title={stocktake.name} subtitle={subtitle} back="/stocktake">
      <div className="card card-pad mb-3">
        <div className="spread mb-2">
          <span className="strong">
            {summary.counted} / {summary.total} counted
          </span>
          <Pill tone={summary.discrepancies ? 'warn' : 'ok'}>
            {plural(summary.discrepancies, 'discrepancy', 'discrepancies')}
          </Pill>
        </div>
        <ProgressBar percent={summary.percent} done={summary.percent === 100} />
        {summary.discrepancies ? (
          <p className="tiny muted mt-2">
            Net {summary.netDelta > 0 ? '+' : ''}
            {summary.netDelta} units across {plural(summary.discrepancies, 'line')}.
          </p>
        ) : null}
        {!open ? (
          <p className="tiny muted mt-2">
            This count is {stocktake.status === 'cancelled' ? 'cancelled' : 'finished'} and kept as the
            record. Start a new stocktake to count again.
          </p>
        ) : null}
      </div>

      <div className="search-bar">
        <input
          className="input grow"
          placeholder="Find an item"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="chip-row mb-3">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={filter === option}
            onClick={() => chooseFilter(option)}
          >
            {FILTER_LABELS[option]}
          </button>
        ))}
      </div>

      {ordered.length ? (
        <div className="list">
          {ordered.slice(0, 200).map((count) => (
            <CountRow
              key={count.id}
              count={count}
              item={items?.get(count.itemId)}
              open={open}
              lastShelf={lastShelf}
              onCount={(value) => commit(count, value)}
              onClear={() => save(count, null)}
              onShelf={(shelf) => fileOnShelf(count, shelf)}
              onNote={(note) => void setCountNote(count.id, note).catch(refused)}
            />
          ))}
        </div>
      ) : (
        <div className="card card-pad center muted">
          {filter === 'todo' ? '✅ Everything in scope has been counted.' : 'Nothing to show.'}
        </div>
      )}

      {discrepancies.length ? (
        <section className="section mt-4">
          <div className="section-head">
            <h2>Biggest differences</h2>
          </div>
          <div className="list">
            {discrepancies.slice(0, 8).map((variance) => (
              <div key={variance.count.id} className="row row-static">
                <span className="row-body truncate">{variance.item?.name ?? 'Unknown'}</span>
                <span
                  className="strong"
                  style={{ color: variance.delta > 0 ? 'var(--ok)' : 'var(--danger)' }}
                >
                  {variance.delta > 0 ? '+' : ''}
                  {variance.delta}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="btn-row mt-4 no-print">
        <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv}>
          ⬇ CSV
        </button>
        {open ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelling(true)}>
            Cancel stocktake
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="action-bar no-print">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setFinishing(true)}>
            Finish &amp; apply corrections
          </button>
        </div>
      ) : null}

      {checking ? (
        <ConfirmSheet
          title={`Record ${checking.value.toLocaleString('en-AU')}?`}
          body={`That is a lot of ${items?.get(checking.count.itemId)?.name ?? 'anything'}. Check the number before it goes on the count.`}
          confirmLabel="Record it"
          onCancel={() => setChecking(undefined)}
          onConfirm={() => {
            save(checking.count, checking.value);
            setChecking(undefined);
          }}
        />
      ) : null}

      {finishing ? (
        <ConfirmSheet
          title="Apply the corrections?"
          body={
            <>
              {summary.discrepancies
                ? `${plural(summary.discrepancies, 'item')} will be corrected on the ledger.`
                : 'Nothing differs from the system, so this just closes the count.'}
              {summary.remaining ? (
                <div className="mt-2">
                  {plural(summary.remaining, 'item')} {summary.remaining === 1 ? 'was' : 'were'} never
                  counted and will be left untouched.
                </div>
              ) : null}
            </>
          }
          confirmLabel="Apply"
          onCancel={() => setFinishing(false)}
          onConfirm={() => {
            void completeStocktake(stocktake, crew).then((applied) => {
              toast(`Stocktake closed · ${plural(applied, 'correction')} applied`);
              setFinishing(false);
            });
          }}
        />
      ) : null}

      {cancelling ? (
        <ConfirmSheet
          title="Cancel this stocktake?"
          body="Counts are kept for the record but nothing is written to stock."
          confirmLabel="Cancel stocktake"
          tone="danger"
          onCancel={() => setCancelling(false)}
          onConfirm={() => {
            void cancelStocktake(stocktake.id).then(() => {
              toast('Stocktake cancelled');
              navigate('/stocktake');
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

/**
 * One count line: the item, the number, its shelf and a note.
 *
 * The system's figure stays hidden until a number is in. Showing it first
 * invites reading it off the screen instead of counting the shelf, which is
 * exactly the mistake a stocktake exists to catch.
 */
function CountRow({
  count,
  item,
  open,
  lastShelf,
  onCount,
  onClear,
  onShelf,
  onNote,
}: {
  count: StocktakeCount;
  item: Item | undefined;
  open: boolean;
  lastShelf: string;
  onCount: (value: number) => void;
  onClear: () => void;
  onShelf: (shelf: string) => void;
  onNote: (note: string) => void;
}) {
  const delta = deltaFor(count);
  const counted = count.counted !== null;
  const unit = item?.unit ?? 'each';
  const [noting, setNoting] = useState(false);

  return (
    <div className={`pack-row${counted && delta === 0 ? ' done' : counted ? ' short' : ''}`}>
      <span className="row-body">
        <span className="row-title">{item?.name ?? 'Unknown item'}</span>
        <span className="row-sub">
          {item?.bin ? `Shelf ${item.bin}` : 'No shelf yet'}
          {counted ? <> · system says {formatQty(count.expected, unit)}</> : null}
          {counted && delta !== 0 ? (
            <span className="strong" style={{ color: delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {' '}
              ({delta > 0 ? '+' : ''}
              {delta})
            </span>
          ) : null}
        </span>
        {count.note && !noting ? <span className="row-sub">📝 {count.note}</span> : null}
      </span>

      {open ? (
        <span className="row-end stocktake-controls">
          <ShelfBox bin={item?.bin ?? ''} lastShelf={lastShelf} itemName={item?.name ?? 'item'} onSave={onShelf} />
          <CountBox
            label={`count of ${item?.name ?? 'item'}`}
            value={count.counted}
            onCommit={onCount}
          />
          <span className="stocktake-line-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNoting(true)}>
              {count.note ? 'Edit note' : 'Note'}
            </button>
            {counted ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
                Clear
              </button>
            ) : null}
          </span>
          {noting ? (
            <input
              className="input stocktake-note"
              aria-label={`Note on ${item?.name ?? 'item'}`}
              placeholder="Two boxes water damaged"
              defaultValue={count.note}
              maxLength={200}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              onBlur={(event) => {
                if (event.currentTarget.value.trim() !== count.note) onNote(event.currentTarget.value);
                setNoting(false);
              }}
            />
          ) : null}
        </span>
      ) : (
        <span className="row-end">
          <span className="pack-qty">{counted ? formatQty(count.counted ?? 0, unit) : 'Not counted'}</span>
        </span>
      )}
    </div>
  );
}

/**
 * The shelf box. Typed shelves are tidied to upper case on the way in, and
 * the last one typed is offered as a one-tap answer for an item that has none:
 * the next thing along the rack is usually on the same shelf.
 */
function ShelfBox({
  bin,
  lastShelf,
  itemName,
  onSave,
}: {
  bin: string;
  lastShelf: string;
  itemName: string;
  onSave: (shelf: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const offer = !bin && lastShelf && draft === null;

  return (
    <span className="stocktake-shelf">
      <input
        className="input"
        aria-label={`Shelf for ${itemName}`}
        placeholder="Shelf"
        autoCapitalize="characters"
        autoComplete="off"
        value={draft ?? bin}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={() => {
          if (draft !== null && tidyShelf(draft) !== bin) onSave(draft);
          setDraft(null);
        }}
      />
      {offer ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`Put ${itemName} on shelf ${lastShelf}`}
          onClick={() => onSave(lastShelf)}
        >
          {lastShelf}?
        </button>
      ) : null}
    </span>
  );
}

/**
 * Number entry for a count.
 *
 * Its own box rather than the shared stepper, because a count has rules the
 * stepper does not: a negative is a mistake to say so about, not something to
 * round up to zero, and four-digit counts of cable ties need room to show.
 */
function CountBox({
  value,
  label,
  onCommit,
}: {
  value: number | null;
  label: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const current = value ?? 0;

  return (
    <div className="stepper count-box" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value === null || current <= 0}
        onClick={() => onCommit(Math.max(0, current - 1))}
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? (value === null ? '' : String(value))}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={() => {
          if (draft !== null) {
            // A box cleared to nothing is left alone rather than read as zero;
            // clearing a count is the Clear button's job.
            const text = draft.replace(/,/g, '').trim();
            if (text) onCommit(Number(text));
            setDraft(null);
          }
        }}
      />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onCommit(value === null ? 1 : current + 1)}>
        +
      </button>
    </div>
  );
}
