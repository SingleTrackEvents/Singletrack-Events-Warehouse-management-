import { useMemo, useState } from 'react';
import { Field, Sheet, Stepper } from './ui';
import { useDebounced } from '../hooks/useSearch';
import { useEvents, useItems } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { isEventScoped } from '../sync/permissions';
import { cleanShop, matchItems } from '../domain/shopping';
import { formatQtyDetail } from '../domain/format';
import type { Item, ShoppingLine, Unit } from '../db/types';
import { UNITS } from '../db/types';

/** What the sheet hands back: enough to write a line or change one. */
export interface ShoppingDraft {
  itemId: string | null;
  name: string;
  qty: number;
  unit: Unit;
  shop: string;
  note: string;
  eventId: string | null;
}

/**
 * Add a line to the shopping list, or change one.
 *
 * The name box searches the catalogue as it is typed, because most of what
 * gets bought is something the warehouse already tracks, and a line that
 * names the item is the one that can be booked into stock when it is home.
 * Tapping a match takes the item's name and unit; typing on past the matches
 * keeps the words as a free-text line, for the things the catalogue does not
 * hold. Nothing forces the choice.
 */
export function ShoppingLineSheet({
  initial,
  shops,
  onClose,
  onSave,
}: {
  /** The line being changed, or nothing for a new one. */
  initial?: ShoppingLine;
  /** Shops the list already uses, offered as chips. */
  shops: string[];
  onClose: () => void;
  onSave: (draft: ShoppingDraft) => void;
}) {
  const items = useItems();
  const events = useEvents();
  const { session } = useSession();
  // Crew given one event buy for that event and nothing else.
  const pinnedEvent = isEventScoped(session) ? session?.scope.eventId ?? null : null;

  const [name, setName] = useState(initial?.name ?? '');
  const [itemId, setItemId] = useState<string | null>(initial?.itemId ?? null);
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'each');
  const [shop, setShop] = useState(initial?.shop ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [eventId, setEventId] = useState<string | null>(initial?.eventId ?? pinnedEvent);

  const query = useDebounced(name);
  const linked = itemId ? items?.find((item) => item.id === itemId) : undefined;
  // Once an item is chosen the matches are put away; they come back the
  // moment the name is edited, since that is a change of mind.
  const matches = useMemo(
    () => (linked && linked.name === name ? [] : matchItems(items ?? [], query)),
    [items, query, linked, name],
  );

  const choose = (item: Item) => {
    setItemId(item.id);
    setName(item.name);
    setUnit(item.unit);
  };

  const rename = (next: string) => {
    setName(next);
    // Editing the name of a linked item unlinks it: the words no longer say
    // what the catalogue says, so the line is whatever was typed.
    if (linked && next !== linked.name) setItemId(null);
  };

  const save = () =>
    onSave({
      itemId,
      name: name.trim(),
      qty,
      unit,
      shop: cleanShop(shop),
      note: note.trim(),
      eventId,
    });

  return (
    <Sheet
      title={initial ? 'Change this line' : 'Add to the shopping list'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim() || qty <= 0} onClick={save}>
            {initial ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field
          label="What"
          hint={
            linked
              ? `Catalogue item · ${formatQtyDetail(linked)} on hand. Bought lines can be booked straight into stock.`
              : 'Start typing to search the stock list, or keep going for something the warehouse does not track.'
          }
        >
          {(id) => (
            <>
              <input
                id={id}
                className="input"
                autoFocus={!initial}
                value={name}
                placeholder="Coke cans"
                autoComplete="off"
                onChange={(event) => rename(event.target.value)}
              />
              {matches.length ? (
                <div className="list mt-2" role="listbox" aria-label="Matching stock items">
                  {matches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="row"
                      role="option"
                      aria-selected={false}
                      onClick={() => choose(item)}
                    >
                      <span className="row-icon">📦</span>
                      <span className="row-body">
                        <span className="row-title">{item.name}</span>
                        <span className="row-sub">
                          {item.sku} · {formatQtyDetail(item)} on hand
                          {item.minQty > 0 ? ` · reorder at ${item.minQty}` : ''}
                        </span>
                      </span>
                      <span className="row-chevron">›</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Field>

        <div className="field-row">
          <Field label="How many">
            {(id) => (
              <span id={id}>
                <Stepper label="quantity" value={qty} min={0} onChange={setQty} />
              </span>
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select
                id={id}
                className="select"
                value={unit}
                disabled={Boolean(linked)}
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
        </div>

        <Field label="Shop or supplier" hint="Leave blank for anywhere. The list is read one shop at a time.">
          {(id) => (
            <>
              <input
                id={id}
                className="input"
                value={shop}
                placeholder="Costco"
                autoComplete="off"
                onChange={(event) => setShop(event.target.value)}
              />
              {shops.length ? (
                <div className="chip-row-inline mt-2">
                  {shops.slice(0, 6).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="chip"
                      aria-pressed={cleanShop(shop).toLowerCase() === option.toLowerCase()}
                      onClick={() => setShop(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Field>

        <Field label="For">
          {(id) => (
            <select
              id={id}
              className="select"
              value={eventId ?? ''}
              disabled={Boolean(pinnedEvent)}
              onChange={(event) => setEventId(event.target.value || null)}
            >
              {!pinnedEvent ? <option value="">Warehouse restock</option> : null}
              {(events ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
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
              placeholder="The 600ml ones, not the 1.25L"
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
