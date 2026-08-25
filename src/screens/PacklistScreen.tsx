import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ItemPicker } from '../components/ItemPicker';
import { ConfirmSheet, Field, Pill, ProgressBar, Sheet, Stepper } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, byId, update } from '../db/repo';
import { useCrewName, usePacklist, usePacklistLines } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can, isStationOnly } from '../sync/permissions';
import {
  NEXT_STATUS_ACTION,
  PACKLIST_STATUS_LABELS,
  addLine,
  applyTemplate,
  clearConfirmations,
  clearNotes,
  hasIssued,
  isConfirmed,
  nextStatus,
  progressFor,
  receiptFor,
  received,
  removeLine,
  setStatus,
  statusIndex,
} from '../domain/packlists';
import { formatQty, plural } from '../domain/format';
import type { PacklistLine, PacklistStatus, Unit } from '../db/types';

type Filter = 'todo' | 'all' | 'packed' | 'musthave';

/** How long a completed line stays on the "To pack" list before it goes. */
const LINGER_MS = 1000;

const FILTER_LABELS: Record<Filter, string> = {
  todo: 'To pack',
  all: 'All',
  packed: 'Packed',
  musthave: 'Must-have',
};

/** The same four filters, worded for someone checking a delivery in. */
const CHECK_FILTER_LABELS: Record<Filter, string> = {
  todo: 'To check',
  all: 'All',
  packed: 'Confirmed',
  musthave: 'Must-have',
};

const STATUS_TONE: Record<PacklistStatus, 'ok' | 'warn' | 'info' | 'accent' | 'default'> = {
  draft: 'default',
  picking: 'accent',
  packed: 'ok',
  loaded: 'info',
  delivered: 'info',
  returned: 'warn',
  reconciled: 'ok',
};

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
  const navigate = useNavigate();
  const toast = useToast();
  const crew = useCrewName();
  const packlist = usePacklist(packlistId);
  const lines = usePacklistLines(packlistId);
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);
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
  const canManage = can(session, 'packlist:manage');
  const canAdvance = canManage || can(session, 'load:deliver');
  const stationOnly = isStationOnly(session);

  const [filter, setFilter] = useState<Filter>('todo');
  const [picking, setPicking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmAdvance, setConfirmAdvance] = useState<PacklistStatus>();
  const [notesOpen, setNotesOpen] = useState(false);
  const [removingLine, setRemovingLine] = useState<PacklistLine>();
  const [editingRequired, setEditingRequired] = useState<PacklistLine>();
  const [clearing, setClearing] = useState<'confirmations' | 'notes'>();

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

  /** Whichever count this view is keeping: packed by the warehouse, or arrived. */
  const countOn = (line: PacklistLine) => (canPack ? line.qtyPacked : received(line));

  /** Hold the row if this change is what completed the line. */
  const packTo = (line: PacklistLine, qty: number) => {
    void update(db.packlistLines, line.id, canPack ? { qtyPacked: qty } : { qtyReceived: qty });
    if (qty >= line.qtyRequired && countOn(line) < line.qtyRequired) linger(line.id);
  };

  const progress = useMemo(
    () => (canPack ? progressFor(lines ?? []) : receiptFor(lines ?? [])),
    [lines, canPack],
  );
  const returning =
    canPack && packlist ? statusIndex(packlist.status) >= statusIndex('delivered') : false;

  // What each reset would actually touch, so the offer can be honest about it
  // — and so a list with nothing to clear says so rather than pretending.
  const confirmedLines = (lines ?? []).filter(isConfirmed).length;
  const notedLines = (lines ?? []).filter((line) => line.note).length;

  const visible = useMemo(() => {
    const all = lines ?? [];
    const got = (line: PacklistLine) => (canPack ? line.qtyPacked : received(line));
    if (filter === 'all') return all;
    if (filter === 'packed') return all.filter((line) => got(line) >= line.qtyRequired);
    if (filter === 'musthave') return all.filter((line) => line.mandatory);
    return all.filter((line) => got(line) < line.qtyRequired || lingering.has(line.id));
  }, [lines, filter, lingering, canPack]);

  if (!packlist) {
    return (
      <Screen title="Packlist" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const advanceTo = nextStatus(packlist.status);
  const advanceLabel = NEXT_STATUS_ACTION[packlist.status];

  /** Tapping a row is all-or-nothing; the stepper handles partial counts. */
  const toggleLine = (line: PacklistLine) => {
    const full = countOn(line) >= line.qtyRequired;
    packTo(line, full ? 0 : line.qtyRequired);
    if (!full && navigator.vibrate) navigator.vibrate(15);
  };

  const advance = async (status: PacklistStatus) => {
    await setStatus(packlist, status, { by: crew });
    const messages: Partial<Record<PacklistStatus, string>> = {
      packed: 'Marked packed',
      loaded: 'Loaded — stock deducted from the warehouse',
      delivered: 'Marked delivered',
      returned: 'Marked returned — count what came back',
      reconciled: 'Returns booked back into stock',
    };
    toast(messages[status] ?? 'Updated');
  };

  return (
    <Screen
      title={packlist.name}
      subtitle={`${packlist.code} · ${PACKLIST_STATUS_LABELS[packlist.status]}`}
      back={stationOnly ? '/' : `/events/${packlist.eventId}`}
      actions={
        canManage ? (
          <button
            type="button"
            className="header-btn"
            aria-label="Labels and printing"
            onClick={() => navigate(`/packlists/${packlist.id}/labels`)}
          >
            🏷
          </button>
        ) : undefined
      }
    >
      <div className="card card-pad mb-3">
        <div className="spread mb-2">
          <span className="strong">
            {progress.linesDone} / {progress.linesTotal} {canPack ? 'lines' : 'lines confirmed'}
          </span>
          <Pill tone={STATUS_TONE[packlist.status]}>{PACKLIST_STATUS_LABELS[packlist.status]}</Pill>
        </div>
        <ProgressBar percent={progress.percent} done={progress.percent === 100} />
        {progress.blocking.length ? (
          <p className="tiny mt-2" style={{ color: 'var(--danger)' }}>
            ⚠ {plural(progress.blocking.length, 'must-have item')}{' '}
            {canPack ? 'still short' : 'not confirmed yet'}
          </p>
        ) : null}
        {destination?.accessNotes ? (
          <p className="tiny muted mt-2">🚙 {destination.accessNotes}</p>
        ) : null}
        {packlist.notes ? <p className="tiny muted mt-2">📝 {packlist.notes}</p> : null}
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
            {(canPack ? FILTER_LABELS : CHECK_FILTER_LABELS)[option]}
          </button>
        ))}
      </div>

      {visible.length ? (
        <div className="list">
          {visible.map((line) => {
            const item = items?.get(line.itemId);
            const count = countOn(line);
            const packed = count >= line.qtyRequired;
            const short = count > 0 && !packed;
            return (
              <div
                key={line.id}
                className={`pack-row${packed ? ' done' : short ? ' short' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => !returning && toggleLine(line)}
                onKeyDown={(event) => {
                  if (!returning && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    toggleLine(line);
                  }
                }}
              >
                {!returning ? (
                  <span className="pack-check" aria-hidden>
                    ✓
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
                  {/* What the station counted, so a short delivery is visible
                      back at the warehouse rather than only recorded. */}
                  {canPack && isConfirmed(line) ? (
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
                      Sent {formatQty(line.qtyPacked, item?.unit ?? 'each')}
                    </div>
                    <Stepper
                      label="returned"
                      value={line.qtyReturned}
                      max={line.qtyPacked}
                      onChange={(value) => void update(db.packlistLines, line.id, { qtyReturned: value })}
                    />
                  </span>
                ) : (
                  <span className="row-end">
                    {canManage ? (
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
                        of {formatQty(line.qtyRequired, item?.unit ?? 'each')}{' '}
                        <span aria-hidden>✎</span>
                      </button>
                    ) : (
                      <span className="pack-qty mb-2">
                        of {formatQty(line.qtyRequired, item?.unit ?? 'each')}
                      </span>
                    )}
                    <Stepper
                      label={canPack ? 'packed' : 'arrived'}
                      value={count}
                      onChange={(value) => packTo(line, value)}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card card-pad center muted">
          {filter === 'todo' && progress.linesTotal
            ? '🎉 Everything on this list is packed.'
            : 'Nothing here yet.'}
        </div>
      )}

      {canManage ? (
        <div className="btn-row mt-4 no-print">
          <button type="button" className="btn btn-outline" onClick={() => setPicking(true)}>
            + Add items
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setApplying(true)}>
            📋 Apply template
          </button>
        </div>
      ) : null}
      <div className="btn-row mt-2 no-print">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotesOpen(true)}>
          📝 Notes
        </button>
        {canManage ? (
          <Link className="btn btn-ghost btn-sm" to={`/packlists/${packlist.id}/labels`}>
            🏷 Labels &amp; print
          </Link>
        ) : null}
      </div>

      {canManage && lines?.length ? (
        <details className="card card-pad mt-4 no-print">
          <summary className="small strong">Remove a line</summary>
          <div className="list mt-3">
            {lines.map((line) => (
              <div key={line.id} className="row row-static">
                <span className="row-body truncate">{items?.get(line.itemId)?.name ?? 'Unknown'}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Remove line"
                  onClick={() => setRemovingLine(line)}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {canManage ? (
        <details className="card card-pad mt-3 no-print">
          <summary className="small strong">Start this list again</summary>
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
        </details>
      ) : null}

      {canAdvance && advanceTo && advanceLabel ? (
        <div className="action-bar no-print">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => {
              // Going to `loaded` moves real stock, and short must-haves are
              // worth a second look, so both get a confirmation step.
              if (advanceTo === 'loaded' || (advanceTo === 'packed' && progress.blocking.length)) {
                setConfirmAdvance(advanceTo);
              } else {
                void advance(advanceTo);
              }
            }}
          >
            {advanceLabel}
          </button>
        </div>
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

      {applying ? (
        <ApplyTemplateSheet
          packlistId={packlist.id}
          onClose={() => setApplying(false)}
          onApplied={(count) => {
            toast(`${plural(count, 'template line')} merged in`);
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
          onClose={() => setEditingRequired(undefined)}
          onSave={(qtyRequired) => {
            void update(db.packlistLines, editingRequired.id, { qtyRequired }).then(() => {
              toast(`Now needs ${formatQty(qtyRequired, items?.get(editingRequired.itemId)?.unit ?? 'each')}`);
              setEditingRequired(undefined);
            });
          }}
        />
      ) : null}

      {removingLine ? (
        <ConfirmSheet
          title="Remove this line?"
          body={items?.get(removingLine.itemId)?.name ?? ''}
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemovingLine(undefined)}
          onConfirm={() => {
            void removeLine(removingLine.id);
            setRemovingLine(undefined);
            toast('Line removed');
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

      {confirmAdvance ? (
        <ConfirmSheet
          title={
            confirmAdvance === 'loaded'
              ? 'Mark as loaded?'
              : `Mark packed with ${plural(progress.blocking.length, 'must-have')} short?`
          }
          body={
            confirmAdvance === 'loaded' ? (
              <>
                This takes {plural(progress.qtyPacked, 'unit')} off the warehouse shelves and writes it
                to the stock ledger.
                {hasIssued(packlist.status) ? ' Stock was already issued, so nothing moves twice.' : ''}
              </>
            ) : (
              <>
                {progress.blocking.map((line) => (
                  <div key={line.id}>
                    • {items?.get(line.itemId)?.name} — {line.qtyPacked} of {line.qtyRequired}
                  </div>
                ))}
              </>
            )
          }
          confirmLabel="Confirm"
          onCancel={() => setConfirmAdvance(undefined)}
          onConfirm={() => {
            const target = confirmAdvance;
            setConfirmAdvance(undefined);
            void advance(target);
          }}
        />
      ) : null}
    </Screen>
  );
}

function ApplyTemplateSheet({
  packlistId,
  onClose,
  onApplied,
}: {
  packlistId: string;
  onClose: () => void;
  onApplied: (count: number) => void;
}) {
  const templates = useLiveQuery(async () => alive(await db.templates.toArray()), []);
  const [runners, setRunners] = useState(0);

  return (
    <Sheet title="Apply a template" onClose={onClose}>
      <p className="small muted mb-3">
        Template quantities are added to what is already on the list — the same item is topped up, not
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
        {(templates ?? []).map((template) => (
          <button
            key={template.id}
            type="button"
            className="row"
            onClick={() => {
              void applyTemplate(packlistId, template, runners).then(onApplied);
            }}
          >
            <span className="row-icon">📋</span>
            <span className="row-body">
              <span className="row-title">{template.name}</span>
              <span className="row-sub truncate">{template.description}</span>
            </span>
            <span className="row-chevron">›</span>
          </button>
        ))}
      </div>
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
  onClose,
  onSave,
}: {
  line: PacklistLine;
  itemName: string;
  unit: Unit;
  onClose: () => void;
  onSave: (qtyRequired: number) => void;
}) {
  const [qty, setQty] = useState(line.qtyRequired);

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
      </div>
    </Sheet>
  );
}
