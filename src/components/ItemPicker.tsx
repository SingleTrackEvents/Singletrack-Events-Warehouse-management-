import { useState } from 'react';
import { Sheet } from './ui';
import { useSearch } from '../hooks/useSearch';
import { useCategories, useItems } from '../hooks/useDb';
import { formatQtyDetail } from '../domain/format';
import type { Item } from '../db/types';

/**
 * Search-and-pick over the item catalogue.
 *
 * Multi-select with a running count, because adding twelve things to a packlist
 * one sheet at a time is exactly the kind of friction that gets an app
 * abandoned halfway through a load-out.
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
  onPick: (items: Item[]) => void;
}) {
  const items = useItems();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const excluded = new Set(exclude);
  const available = (items ?? []).filter((item) => !item.archived && !excluded.has(item.id));
  const matches = useSearch(available, query, (item) => [item.name, item.sku, item.bin]);
  const categoryName = (id: string | null) =>
    categories?.find((category) => category.id === id)?.name ?? 'Uncategorised';

  const chosen = matches.filter((item) => selected[item.id]);
  const count = Object.values(selected).filter(Boolean).length;

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
            disabled={!count}
            onClick={() => onPick((items ?? []).filter((item) => selected[item.id]))}
          >
            Add {count || ''}
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

      {chosen.length ? <p className="tiny muted mb-2">{count} selected</p> : null}

      <div className="list">
        {matches.slice(0, 120).map((item) => (
          <label key={item.id} className="row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 24, height: 24, accentColor: 'var(--accent)' }}
              checked={Boolean(selected[item.id])}
              onChange={(event) =>
                setSelected((current) => ({ ...current, [item.id]: event.target.checked }))
              }
            />
            <span className="row-body">
              <span className="row-title truncate">{item.name}</span>
              <span className="row-sub">
                {categoryName(item.categoryId)} · {item.bin || 'no bin'} · {formatQtyDetail(item)} on hand
              </span>
            </span>
          </label>
        ))}
        {!matches.length ? <div className="row row-static muted">Nothing matches “{query}”.</div> : null}
      </div>
    </Sheet>
  );
}
