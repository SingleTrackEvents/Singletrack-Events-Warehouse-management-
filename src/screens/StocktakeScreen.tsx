import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Field, Pill, Sheet } from '../components/ui';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { useCategories, useCrewName } from '../hooks/useDb';
import { startStocktake, summarise } from '../domain/stocktake';
import { describeStocktakeRemoval, removeStocktake } from '../domain/remove';
import type { StocktakeRemoval } from '../domain/remove';
import type { Stocktake } from '../db/types';
import { formatDateTime, plural } from '../domain/format';

/** Stocktake sessions: what is open, what has been done, and how to start one. */
export default function StocktakeScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<{ stocktake: Stocktake; summary: StocktakeRemoval }>();

  // Read before anything changes, so the confirmation can name what goes.
  const askToRemove = (stocktake: Stocktake) => {
    void describeStocktakeRemoval(stocktake.id).then((summary) =>
      setRemoving({ stocktake, summary }),
    );
  };

  const stocktakes = useLiveQuery(
    async () =>
      alive(await db.stocktakes.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [],
  );

  const progress = useLiveQuery(async () => {
    const counts = alive(await db.stocktakeCounts.toArray());
    const map = new Map<string, ReturnType<typeof summarise>>();
    for (const count of counts) {
      const bucket = counts.filter((entry) => entry.stocktakeId === count.stocktakeId);
      if (!map.has(count.stocktakeId)) map.set(count.stocktakeId, summarise(bucket));
    }
    return map;
  }, [stocktakes]);

  const open = stocktakes?.filter((entry) => entry.status === 'open') ?? [];
  const done = stocktakes?.filter((entry) => entry.status !== 'open') ?? [];

  return (
    <Screen
      title="Stocktake"
      back="/stock"
      actions={
        <button type="button" className="header-btn" aria-label="Start stocktake" onClick={() => setStarting(true)}>
          +
        </button>
      }
    >
      {stocktakes && !stocktakes.length ? (
        <EmptyState
          glyph="🔢"
          title="No stocktakes yet"
          body="Count the racks and the app will correct the numbers and record why."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}>
              Start a stocktake
            </button>
          }
        />
      ) : null}

      {open.length ? (
        <section className="section">
          <div className="section-head">
            <h2>In progress</h2>
          </div>
          <div className="list">
            {open.map((stocktake) => {
              const summary = progress?.get(stocktake.id);
              return (
                <SwipeToDelete key={stocktake.id} onDelete={() => askToRemove(stocktake)}>
                <Link to={`/stocktake/${stocktake.id}`} className="row">
                  <span className="row-icon">🔢</span>
                  <span className="row-body">
                    <span className="row-title">{stocktake.name}</span>
                    <span className="row-sub">
                      {summary ? `${summary.counted} of ${summary.total} counted` : 'Starting…'}
                    </span>
                  </span>
                  <Pill tone="accent">{summary?.percent ?? 0}%</Pill>
                </Link>
                </SwipeToDelete>
              );
            })}
          </div>
        </section>
      ) : null}

      {done.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Completed</h2>
          </div>
          <div className="list">
            {done.map((stocktake) => {
              const summary = progress?.get(stocktake.id);
              return (
                <SwipeToDelete key={stocktake.id} onDelete={() => askToRemove(stocktake)}>
                <Link to={`/stocktake/${stocktake.id}`} className="row">
                  <span className="row-body">
                    <span className="row-title">{stocktake.name}</span>
                    <span className="row-sub">
                      {formatDateTime(stocktake.completedAt ?? stocktake.createdAt)}
                      {summary ? ` · ${plural(summary.discrepancies, 'discrepancy', 'discrepancies')}` : ''}
                    </span>
                  </span>
                  <Pill tone={stocktake.status === 'completed' ? 'ok' : 'default'}>
                    {stocktake.status === 'completed' ? 'Done' : 'Cancelled'}
                  </Pill>
                </Link>
                </SwipeToDelete>
              );
            })}
          </div>
        </section>
      ) : null}

      {open.length || done.length ? (
        <p className="tiny muted center mt-3">Swipe a count left to delete it.</p>
      ) : null}

      {removing ? (
        <ConfirmSheet
          title={`Delete ${removing.stocktake.name}?`}
          body={
            <>
              {plural(removing.summary.counts, 'count line')} go with it.
              {removing.summary.corrections ? (
                <div className="mt-2">
                  The {plural(removing.summary.corrections, 'correction')} it already applied stay on
                  the stock ledger — that is the record of what was on the shelf, and tidying old
                  counts away is no reason to rewrite it.
                </div>
              ) : null}
            </>
          }
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            const target = removing.stocktake;
            setRemoving(undefined);
            void removeStocktake(target.id).then(() => toast(`${target.name} deleted`));
          }}
        />
      ) : null}

      {starting ? (
        <StartSheet onClose={() => setStarting(false)} onStarted={(id) => navigate(`/stocktake/${id}`)} />
      ) : null}
    </Screen>
  );
}

function StartSheet({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const categories = useCategories();
  const crew = useCrewName();
  const toast = useToast();
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const [name, setName] = useState(`Stocktake ${today}`);
  const [categoryId, setCategoryId] = useState('');
  const [working, setWorking] = useState(false);

  const start = async () => {
    setWorking(true);
    const stocktake = await startStocktake(name, { categoryId: categoryId || null, startedBy: crew });
    toast('Stocktake started');
    onStarted(stocktake.id);
  };

  return (
    <Sheet
      title="Start a stocktake"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={working} onClick={() => void start()}>
            {working ? 'Starting…' : 'Start'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Scope" hint="Counting one category at a time is far quicker than the whole shed.">
          {(id) => (
            <select
              id={id}
              className="select"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Everything</option>
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.icon} {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </Sheet>
  );
}
