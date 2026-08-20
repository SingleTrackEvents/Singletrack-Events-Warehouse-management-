import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '../App';
import { EmptyState, Field, Pill, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSearch } from '../hooks/useSearch';
import { db } from '../db/db';
import { create } from '../db/repo';
import { useCategories, useItems } from '../hooks/useDb';
import { isLowStock } from '../domain/stock';
import { formatQtyDetail, plural } from '../domain/format';
import type { Unit } from '../db/types';
import { UNITS } from '../db/types';

/**
 * The warehouse catalogue.
 *
 * Search is the primary control — with a few hundred items, scrolling is slower
 * than typing three letters — backed by category chips and a low-stock filter
 * for the weekly reorder run.
 */
export default function StockScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const items = useItems();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const categoryFilter = params.get('category') ?? '';
  const lowOnly = params.get('filter') === 'low';

  /**
   * The chip strip reads as one row of alternatives, so it behaves as one:
   * choosing a category clears the low-stock filter and vice versa. Letting the
   * two stack silently emptied the list with no visible cause — the strip
   * scrolls sideways, so the other active chip was usually off-screen.
   */
  const selectOnly = (next: { category?: string; low?: boolean }) => {
    const params = new URLSearchParams();
    if (next.category) params.set('category', next.category);
    if (next.low) params.set('filter', 'low');
    setParams(params, { replace: true });
  };

  /** Drop every filter, including anything typed in the search box. */
  const clearFilters = () => {
    setQuery('');
    setParams({}, { replace: true });
  };

  const base = (items ?? []).filter((item) => {
    if (item.archived) return false;
    if (categoryFilter && item.categoryId !== categoryFilter) return false;
    if (lowOnly && !isLowStock(item)) return false;
    return true;
  });

  const matches = useSearch(base, query, (item) => [item.name, item.sku, item.bin, item.notes]);
  const lowCount = (items ?? []).filter(isLowStock).length;
  const activeCategory = categories?.find((category) => category.id === categoryFilter);
  // An empty list means something different when a filter is on than when the
  // catalogue is genuinely empty, and the two need different ways out.
  const filtered = Boolean(categoryFilter) || lowOnly || Boolean(query.trim());
  const totalItems = (items ?? []).filter((item) => !item.archived).length;

  return (
    <Screen
      title="Stock"
      subtitle={items ? `${plural(items.length, 'item')} · ${lowCount} low` : undefined}
      actions={
        <button type="button" className="header-btn" aria-label="Add item" onClick={() => setAdding(true)}>
          +
        </button>
      }
    >
      <div className="search-bar">
        <input
          className="input grow"
          placeholder="Search stock"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-outline"
          aria-label="Scan a barcode"
          onClick={() => navigate('/scan')}
        >
          ⛶
        </button>
      </div>

      <div className="chip-row mb-3">
        <button
          type="button"
          className="chip"
          aria-pressed={!categoryFilter && !lowOnly}
          onClick={() => selectOnly({})}
        >
          All
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={lowOnly}
          onClick={() => selectOnly({ low: !lowOnly })}
        >
          ⚠ Low ({lowCount})
        </button>
        {(categories ?? []).map((category) => (
          <button
            key={category.id}
            type="button"
            className="chip"
            aria-pressed={categoryFilter === category.id}
            onClick={() =>
              selectOnly({ category: categoryFilter === category.id ? '' : category.id })
            }
          >
            {category.icon} {category.name}
          </button>
        ))}
      </div>

      {matches.length ? (
        <div className="list">
          {matches.map((item) => (
            <Link key={item.id} to={`/stock/${item.id}`} className="row">
              <span className="row-body">
                <span className="row-title truncate">{item.name}</span>
                <span className="row-sub">
                  {item.bin || 'no bin'} · {item.sku}
                </span>
              </span>
              <span className="row-end">
                <div className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatQtyDetail(item)}
                </div>
                {isLowStock(item) ? (
                  <Pill tone="danger">Low</Pill>
                ) : (
                  <span className="tiny muted">min {item.minQty}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          glyph={filtered ? '🔍' : '📦'}
          title={filtered ? 'Nothing matches those filters' : 'Nothing here yet'}
          body={
            filtered
              ? [
                  query.trim() ? `“${query.trim()}”` : '',
                  lowOnly ? 'below reorder point' : '',
                  activeCategory ? activeCategory.name : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Add your first item to get started.'
          }
          action={
            filtered ? (
              <button type="button" className="btn btn-primary" onClick={clearFilters}>
                Show all {plural(totalItems, 'item')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                Add an item
              </button>
            )
          }
        />
      )}

      <div className="mt-4">
        <Link to="/stocktake" className="btn btn-outline btn-block">
          🔢 Stocktake
        </Link>
      </div>

      {adding ? <NewItemSheet onClose={() => setAdding(false)} /> : null}
    </Screen>
  );
}

function NewItemSheet({ onClose }: { onClose: () => void }) {
  const categories = useCategories();
  const toast = useToast();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState<Unit>('each');
  const [packSize, setPackSize] = useState('1');
  const [bin, setBin] = useState('');
  const [qty, setQty] = useState('0');
  const [minQty, setMinQty] = useState('0');
  const [consumable, setConsumable] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    const opening = Number(qty) || 0;
    const item = await create(db.items, {
      name: name.trim(),
      sku: sku.trim().toUpperCase(),
      categoryId: categoryId || null,
      unit,
      packSize: Math.max(1, Number(packSize) || 1),
      bin: bin.trim(),
      qtyOnHand: opening,
      minQty: Number(minQty) || 0,
      barcode: null,
      notes: '',
      consumable,
      archived: false,
    });
    // Opening balance goes on the ledger so the history is complete from day one.
    if (opening > 0) {
      await create(db.movements, {
        itemId: item.id,
        qty: opening,
        reason: 'receipt',
        balanceAfter: opening,
        refType: 'manual',
        refId: null,
        note: 'Opening balance',
        by: '',
      });
    }
    toast('Item added');
    onClose();
  };

  return (
    <Sheet
      title="New item"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            Add item
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
              autoFocus
              value={name}
              placeholder="Water cube 20L"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="field-row">
          <Field label="SKU">
            {(id) => (
              <input
                id={id}
                className="input mono"
                value={sku}
                placeholder="HYD-CUBE20"
                onChange={(event) => setSku(event.target.value)}
              />
            )}
          </Field>
          <Field label="Bin">
            {(id) => (
              <input
                id={id}
                className="input"
                value={bin}
                placeholder="A1"
                onChange={(event) => setBin(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              className="select"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Uncategorised</option>
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field-row">
          <Field label="Counted in">
            {(id) => (
              <select
                id={id}
                className="select"
                value={unit}
                onChange={(event) => setUnit(event.target.value as Unit)}
              >
                {UNITS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Pack size" hint="Pieces per unit.">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="numeric"
                value={packSize}
                onChange={(event) => setPackSize(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="field-row">
          <Field label="On hand now">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="numeric"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
            )}
          </Field>
          <Field label="Reorder at">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="numeric"
                value={minQty}
                onChange={(event) => setMinQty(event.target.value)}
              />
            )}
          </Field>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={consumable}
            onChange={(event) => setConsumable(event.target.checked)}
          />
          <span>
            <span className="strong">Consumable</span>
            <span className="small muted" style={{ display: 'block' }}>
              Used up at events — not expected to come back.
            </span>
          </span>
        </label>
      </div>
    </Sheet>
  );
}
