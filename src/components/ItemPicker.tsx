import { useState } from 'react';
import { Sheet, Stepper } from './ui';
import { useSearch } from '../hooks/useSearch';
import { useCategories, useItems } from '../hooks/useDb';
import { formatQtyDetail, plural } from '../domain/format';
import type { Item } from '../db/types';

/** An item and how many of it to add. */
export interface ItemPick {
  item: Item;
  qty: number;
}

/**
 * Search-and-pick over the item catalogue.
 *
 * Multi-select with quantities, because a packlist wants four water cubes and
 * two gazebos — not one of each to be corrected afterwards. Adding twelve
 * things one sheet at a time is the kind of friction that gets an app abandoned
 * halfway through a load-out.
 */
export function ItemPicker({
  title = 'Add items',
  exclude = [],
  onClose,
  onPick,
}: {
  title?: string;
  exclude?: string[];
  onClose: () => void;
  onPick: (picks: ItemPick[]) => void;
}) {
  const items = useItems();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  // The quantity doubles as the selection: absent or zero means not picked.
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const excluded = new Set(exclude);
  const available = (items ?? []).filter((item) => !item.archived && !excluded.has(item.id));
  const matches = useSearch(available, query, (item) => [item.name, item.sku, item.bin]);

  const picks: ItemPick[] = (items ?? [])
    .filter((item) => (quantities[item.id] ?? 0) > 0)
    .map((item) => ({ item, qty: quantities[item.id] }));
  const units = picks.reduce((sum, pick) => sum + pick.qty, 0);

  const setQty = (id: string, qty: number) =>
    setQuantities((current) => {
      const next = { ...current };
      if (qty > 0) next[id] = qty;
      else delete next[id];
      return next;
    });

  const categoryName = (id: string | null) =>
    categories?.find((category) => category.id === id)?.name ?? 'Uncategorised';

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!picks.length}
            onClick={() => onPick(picks)}
          >
            {picks.length ? `Add ${picks.length}` : 'Add'}
          </button>
        </>
      }
    >
      <input
        className="input mb-3"
        placeholder="Search name, SKU or bin"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />

      {picks.length ? (
        <p className="tiny muted mb-2">
          {plural(picks.length, 'item')} · {units} total
        </p>
      ) : null}

      <div className="list">
        {matches.slice(0, 120).map((item) => {
          const qty = quantities[item.id] ?? 0;
          return (
            <div key={item.id} className={`pack-row${qty > 0 ? ' done' : ''}`}>
              <span
                className="row-body"
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                // Tapping the name adds one, which is the common case. The
                // stepper is there for the times it is four.
                onClick={() => setQty(item.id, qty > 0 ? 0 : 1)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setQty(item.id, qty > 0 ? 0 : 1);
                  }
                }}
              >
                <span className="row-title">{item.name}</span>
                <span className="row-sub">
                  {categoryName(item.categoryId)} · {item.bin || 'no bin'} ·{' '}
                  {formatQtyDetail(item)} on hand
                </span>
              </span>
              <span className="row-end">
                <Stepper
                  label={`quantity of ${item.name}`}
                  value={qty}
                  min={0}
                  onChange={(next) => setQty(item.id, next)}
                />
              </span>
            </div>
          );
        })}
        {!matches.length ? (
          <div className="row row-static muted">Nothing matches “{query}”.</div>
        ) : null}
      </div>
    </Sheet>
  );
}
