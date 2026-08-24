import { useState } from 'react';
import { Field } from './ui';
import { db } from '../db/db';
import { create, nextSort } from '../db/repo';
import { useCategories } from '../hooks/useDb';

/** Emoji offered when naming a category. Scanning a stock list is visual. */
const ICONS = ['📦', '⛺', '💧', '🔌', '💡', '🔥', '🍽', '🧼', '🚑', '🗑', '🚧', '📡', '🎪', '⏱', '🔧', '🧊', '🪑', '👕'];

/**
 * Pick a category, or make one on the spot.
 *
 * The catalogue arrives with the twenty categories the warehouse spreadsheet
 * uses, but a crew that starts stocking merchandise or a new kind of signage
 * needs somewhere to put it, and sending them to a settings screen mid-entry
 * loses the item they were halfway through adding.
 */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const categories = useCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICONS[0]);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // A name that already exists selects it rather than making a second one.
    const existing = (categories ?? []).find(
      (category) => category.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      onChange(existing.id);
    } else {
      const created = await create(db.categories, {
        name: trimmed,
        sort: nextSort(categories ?? []),
        icon,
      });
      onChange(created.id);
    }
    setName('');
    setAdding(false);
  };

  if (adding) {
    return (
      <Field label="New category">
        {(id) => (
          <>
            <div className="row-flex">
              <input
                id={id}
                className="input grow"
                autoFocus
                value={name}
                placeholder="Merchandise"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void add();
                  }
                }}
              />
              <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void add()}>
                Add
              </button>
            </div>
            <div className="chip-row-inline mt-2">
              {ICONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="chip"
                  aria-pressed={icon === option}
                  aria-label={`Icon ${option}`}
                  onClick={() => setIcon(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-2"
              onClick={() => {
                setAdding(false);
                setName('');
              }}
            >
              Cancel
            </button>
          </>
        )}
      </Field>
    );
  }

  return (
    <Field label="Category">
      {(id) => (
        <select
          id={id}
          className="select"
          value={value}
          onChange={(event) => {
            if (event.target.value === '__new') setAdding(true);
            else onChange(event.target.value);
          }}
        >
          <option value="">Uncategorised</option>
          {(categories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.icon} {category.name}
            </option>
          ))}
          <option value="__new">+ New category…</option>
        </select>
      )}
    </Field>
  );
}
