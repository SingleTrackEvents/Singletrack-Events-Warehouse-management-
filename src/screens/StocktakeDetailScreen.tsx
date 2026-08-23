import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, Pill, ProgressBar, Stepper } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSearch } from '../hooks/useSearch';
import { db } from '../db/db';
import { alive, byId, liveWhere } from '../db/repo';
import { useCrewName } from '../hooks/useDb';
import {
  cancelStocktake,
  completeStocktake,
  deltaFor,
  recordCount,
  summarise,
  variances,
} from '../domain/stocktake';
import { downloadCsv, slugify } from '../domain/backup';
import { formatQty, plural } from '../domain/format';

type Filter = 'todo' | 'all' | 'counted' | 'variance';

const FILTER_LABELS: Record<Filter, string> = {
  todo: 'To count',
  all: 'All',
  counted: 'Counted',
  variance: 'Discrepancies',
};

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

  const [filter, setFilter] = useState<Filter>('todo');
  const [query, setQuery] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
   * list shortens to what genuinely remains.
   */
  const passKey = `${stocktakeId ?? ''}:${filter}`;
  const [pass, setPass] = useState(() => ({ key: passKey, since: new Date().toISOString() }));
  if (pass.key !== passKey) setPass({ key: passKey, since: new Date().toISOString() });

  const filtered = useMemo(() => {
    const all = counts ?? [];
    if (filter === 'all') return all;
    if (filter === 'counted') return all.filter((count) => count.counted !== null);
    if (filter === 'variance') return all.filter((count) => count.counted !== null && deltaFor(count) !== 0);
    return all.filter(
      (count) => count.counted === null || (count.countedAt !== null && count.countedAt >= pass.since),
    );
  }, [counts, filter, pass.since]);

  const searched = useSearch(filtered, query, (count) => {
    const item = items?.get(count.itemId);
    return [item?.name ?? '', item?.sku ?? '', item?.bin ?? ''];
  });

  // Counting in bin order beats alphabetical — you walk the racks, not the A–Z.
  const ordered = useMemo(
    () =>
      [...searched].sort((a, b) => {
        const left = items?.get(a.itemId);
        const right = items?.get(b.itemId);
        return (left?.bin ?? '').localeCompare(right?.bin ?? '') ||
          (left?.name ?? '').localeCompare(right?.name ?? '');
      }),
    [searched, items],
  );

  if (!stocktake) {
    return (
      <Screen title="Stocktake" back="/stocktake">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const open = stocktake.status === 'open';

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

  return (
    <Screen title={stocktake.name} subtitle={open ? 'Counting' : 'Completed'} back="/stocktake">
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
            onClick={() => {
              setFilter(option);
              setPass({ key: `${stocktakeId ?? ''}:${option}`, since: new Date().toISOString() });
            }}
          >
            {FILTER_LABELS[option]}
          </button>
        ))}
      </div>

      {ordered.length ? (
        <div className="list">
          {ordered.slice(0, 200).map((count) => {
            const item = items?.get(count.itemId);
            const delta = deltaFor(count);
            const counted = count.counted !== null;
            return (
              <div
                key={count.id}
                className={`pack-row${counted && delta === 0 ? ' done' : counted ? ' short' : ''}`}
              >
                <span className="row-body">
                  <span className="row-title truncate">{item?.name ?? 'Unknown item'}</span>
                  <span className="row-sub">
                    {item?.bin || 'no bin'} · system says {formatQty(count.expected, item?.unit ?? 'each')}
                    {counted && delta !== 0 ? (
                      <span className="strong" style={{ color: delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                        {' '}
                        ({delta > 0 ? '+' : ''}
                        {delta})
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="row-end stack-sm" style={{ alignItems: 'flex-end' }}>
                  <Stepper
                    label={`count of ${item?.name ?? 'item'}`}
                    /*
                     * Blank, not the expected figure. Pre-filling the system's
                     * own number invites confirming it rather than counting,
                     * and one stray tap would otherwise record "matches" on a
                     * shelf nobody looked at.
                     */
                    value={count.counted}
                    onChange={(value) => void recordCount(count.id, value, { by: crew })}
                  />
                  {open ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        counted
                          ? void recordCount(count.id, null)
                          : void recordCount(count.id, count.expected, { by: crew })
                      }
                    >
                      {counted ? 'Clear' : 'Matches'}
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
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

      {finishing ? (
        <ConfirmSheet
          title="Apply the corrections?"
          body={
            <>
              {summary.discrepancies
                ? `${plural(summary.discrepancies, 'item')} will be corrected on the ledger.`
                : 'Nothing differs from the system — this just closes the count.'}
              {summary.remaining ? (
                <div className="mt-2">
                  {plural(summary.remaining, 'item')} was never counted and will be left untouched.
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
