import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ItemPicker } from '../components/ItemPicker';
import { Scanner } from '../components/Scanner';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { ConfirmSheet, Field, Pill, Sheet, Stepper } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { byId, update } from '../db/repo';
import { useCategories, useCrewName, useItem, useItems } from '../hooks/useDb';
import { addKitContent, isKit, kitLines, removeKitContent, setKitContentQty } from '../domain/kits';
import {
  MOVEMENT_LABELS,
  isLowStock,
  itemHistory,
  recordMovements,
  setQuantity,
} from '../domain/stock';
import { formatDateTime, formatQty, formatQtyDetail } from '../domain/format';
import type { MovementReason, Unit } from '../db/types';
import { UNITS, unitHasPackSize } from '../db/types';
import { PackSizeField } from '../components/PackSizeField';
import { CategoryPicker } from '../components/CategoryPicker';

/** Reasons offered when adjusting by hand, in the order they actually come up. */
const ADJUST_REASONS: MovementReason[] = ['receipt', 'adjustment', 'damaged', 'consumed'];

/** One item: what is on the shelf, how to change it, and why it changed. */
export default function ItemScreen() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const crew = useCrewName();
  const item = useItem(itemId);
  const categories = useCategories();
  const history = useLiveQuery(async () => (itemId ? itemHistory(itemId, 40) : []), [itemId]);
  // Depending on the movements table keeps the ledger live as adjustments land.
  const movementCount = useLiveQuery(async () => db.movements.count(), []);

  const [adjusting, setAdjusting] = useState(false);
  const [counting, setCounting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [addingContents, setAddingContents] = useState(false);
  const allItems = useItems();
  const itemsById = useMemo(() => byId(allItems ?? []), [allItems]);

  if (!item) {
    return (
      <Screen title="Item" back="/stock">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const category = categories?.find((entry) => entry.id === item.categoryId);

  return (
    <Screen
      title={item.name}
      subtitle={item.sku || undefined}
      back="/stock"
      actions={
        <button type="button" className="header-btn" aria-label="Edit item" onClick={() => setEditing(true)}>
          ✎
        </button>
      }
    >
      <div className="card card-pad mb-4">
        <div className="spread">
          <div>
            <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, lineHeight: 1 }}>
              {formatQty(item.qtyOnHand, item.unit)}
            </div>
            <div className="small muted mt-2">
              {item.packSize > 1 ? `${Math.round(item.qtyOnHand * item.packSize)} pieces · ` : ''}
              bin {item.bin || '—'}
            </div>
          </div>
          <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
            {history && !history.length && item.qtyOnHand === 0 ? (
              <Pill>Not counted yet</Pill>
            ) : isLowStock(item) ? (
              <Pill tone="danger">Below reorder</Pill>
            ) : (
              <Pill tone="ok">In stock</Pill>
            )}
            {category ? (
              <Pill>
                {category.icon} {category.name}
              </Pill>
            ) : null}
            {item.consumable ? <Pill tone="warn">Consumable</Pill> : null}
          </div>
        </div>
        {item.notes ? <p className="small muted mt-3">{item.notes}</p> : null}
      </div>

      <div className="btn-row mb-3">
        <button type="button" className="btn btn-primary" onClick={() => setAdjusting(true)}>
          ± Adjust
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setCounting(true)}>
          🔢 Set count
        </button>
      </div>

      <div className="btn-row mb-4">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScanning(true)}>
          {item.barcode ? '⛶ Change barcode' : '⛶ Link a barcode'}
        </button>
        {!isKit(item) ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingContents(true)}>
            📦 List what’s inside
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiving(true)}>
          🗄 Archive
        </button>
      </div>

      {isKit(item) ? (
        <section className="section">
          <div className="section-head">
            <h2>What’s in this kit</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingContents(true)}>
              + Add
            </button>
          </div>
          <p className="tiny muted mb-2">
            Packing this kit on a packlist packs everything below. Swipe a line to take it out.
          </p>
          <div className="list">
            {kitLines(item, itemsById).map((line) => (
              <SwipeToDelete
                key={line.itemId}
                label="Remove"
                onDelete={() => void removeKitContent(item.id, line.itemId)}
              >
                <div className="row row-static">
                  <span className="row-body">
                    <span className="row-title truncate">{line.item?.name ?? 'Unknown item'}</span>
                    <span className="row-sub">{line.item?.sku ?? ''}</span>
                  </span>
                  <span className="row-end">
                    <Stepper
                      label={`${line.item?.name ?? 'item'} in kit`}
                      value={line.qty}
                      min={0}
                      onChange={(next) => void setKitContentQty(item.id, line.itemId, next)}
                    />
                  </span>
                </div>
              </SwipeToDelete>
            ))}
          </div>
        </section>
      ) : null}

      {item.barcode ? (
        <p className="tiny muted mb-4">
          Barcode <span className="mono">{item.barcode}</span> — scanning it opens this item.
        </p>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>Movement history</h2>
          <span className="tiny muted">{movementCount ?? 0} total on device</span>
        </div>
        {history?.length ? (
          <div className="list">
            {history.map((movement) => (
              <div key={movement.id} className="row row-static">
                <span className="row-icon">{movement.qty > 0 ? '⬆️' : '⬇️'}</span>
                <span className="row-body">
                  <span className="row-title">{MOVEMENT_LABELS[movement.reason]}</span>
                  <span className="row-sub">
                    {formatDateTime(movement.createdAt)}
                    {movement.by ? ` · ${movement.by}` : ''}
                    {movement.note ? ` · ${movement.note}` : ''}
                  </span>
                </span>
                <span className="row-end">
                  <div
                    className="strong"
                    style={{ color: movement.qty > 0 ? 'var(--ok)' : 'var(--danger)' }}
                  >
                    {movement.qty > 0 ? '+' : ''}
                    {movement.qty}
                  </div>
                  <div className="tiny muted">→ {movement.balanceAfter}</div>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">No movements recorded yet.</p>
        )}
      </section>

      {adjusting ? (
        <AdjustSheet
          unit={item.unit}
          onClose={() => setAdjusting(false)}
          onSave={(delta, reason, note) => {
            void recordMovements([
              { itemId: item.id, qty: delta, reason, note, by: crew, refType: 'manual' },
            ]).then(() => toast(`${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)}`));
            setAdjusting(false);
          }}
        />
      ) : null}

      {counting ? (
        <CountSheet
          current={item.qtyOnHand}
          unit={item.unit}
          onClose={() => setCounting(false)}
          onSave={(value) => {
            void setQuantity(item.id, value, 'stocktake', { by: crew, note: 'Spot count' }).then(() =>
              toast('Count recorded'),
            );
            setCounting(false);
          }}
        />
      ) : null}

      {editing ? <EditItemSheet itemId={item.id} onClose={() => setEditing(false)} /> : null}

      {scanning ? (
        <Sheet title="Link a barcode" onClose={() => setScanning(false)}>
          <p className="small muted mb-3">
            Scan the supplier barcode on the carton. Next time you scan it anywhere in the app you
            land straight on this item.
          </p>
          <Scanner
            hint="Point at the barcode on the box"
            onDetect={(value) => {
              void update(db.items, item.id, { barcode: value }).then(() => {
                toast('Barcode linked');
                setScanning(false);
              });
            }}
          />
        </Sheet>
      ) : null}

      {addingContents ? (
        <ItemPicker
          title={`Inside ${item.name}`}
          exclude={[item.id, ...(item.contents ?? []).map((content) => content.itemId)]}
          onClose={() => setAddingContents(false)}
          onPick={(picks) => {
            void (async () => {
              let added = 0;
              for (const pick of picks) {
                if (await addKitContent(item.id, pick.item.id, pick.qty)) added += 1;
              }
              const refused = picks.length - added;
              toast(
                refused
                  ? `${added} added — a kit cannot hold another kit`
                  : `${added} added to the kit`,
                refused ? 'warn' : 'ok',
              );
              setAddingContents(false);
            })();
          }}
        />
      ) : null}

      {archiving ? (
        <ConfirmSheet
          title={`Archive ${item.name}?`}
          body="It disappears from search and pickers but stays on past packlists and the ledger."
          confirmLabel="Archive"
          tone="danger"
          onCancel={() => setArchiving(false)}
          onConfirm={() => {
            void update(db.items, item.id, { archived: true }).then(() => {
              toast('Item archived');
              navigate('/stock');
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

function AdjustSheet({
  unit,
  onClose,
  onSave,
}: {
  unit: Unit;
  onClose: () => void;
  onSave: (delta: number, reason: MovementReason, note: string) => void;
}) {
  const [direction, setDirection] = useState<1 | -1>(1);
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState<MovementReason>('receipt');
  const [note, setNote] = useState('');

  return (
    <Sheet
      title="Adjust stock"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={amount <= 0}
            onClick={() => onSave(direction * amount, reason, note.trim())}
          >
            {direction > 0 ? 'Add' : 'Remove'} {amount}
          </button>
        </>
      }
    >
      <div className="btn-row mb-4">
        <button
          type="button"
          className={`btn ${direction > 0 ? 'btn-brand' : 'btn-outline'}`}
          onClick={() => {
            setDirection(1);
            setReason('receipt');
          }}
        >
          + Add
        </button>
        <button
          type="button"
          className={`btn ${direction < 0 ? 'btn-brand' : 'btn-outline'}`}
          onClick={() => {
            setDirection(-1);
            setReason('damaged');
          }}
        >
          − Remove
        </button>
      </div>

      <div className="center mb-4">
        <div className="small muted mb-2">Quantity in {unit}</div>
        <div style={{ display: 'inline-block' }}>
          <Stepper value={amount} onChange={setAmount} min={1} />
        </div>
      </div>

      <Field label="Reason">
        {(id) => (
          <select
            id={id}
            className="select mb-3"
            value={reason}
            onChange={(event) => setReason(event.target.value as MovementReason)}
          >
            {ADJUST_REASONS.map((option) => (
              <option key={option} value={option}>
                {MOVEMENT_LABELS[option]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Note">
        {(id) => (
          <input
            id={id}
            className="input"
            value={note}
            placeholder="Delivery from Bunnings"
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
    </Sheet>
  );
}

function CountSheet({
  current,
  unit,
  onClose,
  onSave,
}: {
  current: number;
  unit: Unit;
  onClose: () => void;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(current);
  const delta = value - current;

  return (
    <Sheet
      title="Set the count"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={delta === 0} onClick={() => onSave(value)}>
            Save count
          </button>
        </>
      }
    >
      <p className="small muted mb-3">
        Enter what is physically on the shelf. The difference is written to the ledger as a stocktake
        correction.
      </p>
      <div className="center mb-3">
        <div style={{ display: 'inline-block' }}>
          <Stepper value={value} onChange={setValue} label={`count in ${unit}`} />
        </div>
      </div>
      <p className="center small">
        System says <span className="strong">{formatQty(current, unit)}</span>
        {delta !== 0 ? (
          <>
            {' '}
            · difference{' '}
            <span className="strong" style={{ color: delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          </>
        ) : null}
      </p>
    </Sheet>
  );
}

function EditItemSheet({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const item = useItem(itemId);
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (!item) return null;
  const value = (key: keyof typeof item) => draft[key] ?? String(item[key] ?? '');

  return (
    <Sheet
      title="Edit item"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void update(db.items, item.id, {
                name: value('name').trim() || item.name,
                sku: value('sku').trim().toUpperCase(),
                bin: value('bin').trim(),
                unit: value('unit') as Unit,
                packSize: Math.max(1, Number(value('packSize')) || 1),
                minQty: Number(value('minQty')) || 0,
                categoryId: draft.categoryId ?? item.categoryId,
                notes: value('notes'),
              }).then(() => {
                toast('Item updated');
                onClose();
              });
            }}
          >
            Save
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
              value={value('name')}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          )}
        </Field>
        <div className="field-row">
          <Field label="SKU">
            {(id) => (
              <input
                id={id}
                className="input mono"
                value={value('sku')}
                onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))}
              />
            )}
          </Field>
          <Field label="Bin">
            {(id) => (
              <input
                id={id}
                className="input"
                value={value('bin')}
                onChange={(event) => setDraft((current) => ({ ...current, bin: event.target.value }))}
              />
            )}
          </Field>
        </div>
        <CategoryPicker
          value={draft.categoryId ?? item.categoryId ?? ''}
          onChange={(categoryId) => setDraft((current) => ({ ...current, categoryId }))}
        />
        <div className="field-row">
          <Field label="Counted in">
            {(id) => (
              <select
                id={id}
                className="select"
                value={value('unit')}
                onChange={(event) => {
                  const next = event.target.value as Unit;
                  setDraft((current) => ({
                    ...current,
                    unit: next,
                    // A unit that holds nothing cannot carry a pack size, and a
                    // stale one left out of sight would multiply the count.
                    packSize: unitHasPackSize(next) ? current.packSize : '1',
                  }));
                }}
              >
                {UNITS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <PackSizeField
            unit={(draft.unit as Unit | undefined) ?? item.unit}
            value={value('packSize')}
            qty={String(item.qtyOnHand)}
            onChange={(next) => setDraft((current) => ({ ...current, packSize: next }))}
          />
          <Field label="Reorder at">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="numeric"
                value={value('minQty')}
                onChange={(event) => setDraft((current) => ({ ...current, minQty: event.target.value }))}
              />
            )}
          </Field>
        </div>
        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={value('notes')}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          )}
        </Field>
        <p className="tiny muted">
          On hand is {formatQtyDetail(item)}. Change it with Adjust or Set count so the ledger stays
          honest.
        </p>
      </div>
    </Sheet>
  );
}
