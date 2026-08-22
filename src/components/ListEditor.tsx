import { useState } from 'react';

/**
 * Edit a short list of names — vehicles, crew.
 *
 * Replaces a comma-separated text field that could not be typed into: it
 * re-derived its text from the parsed list on every keystroke, so a space or a
 * comma was stripped the moment it was entered and "6m Truck" was impossible.
 * Entries are added one at a time here, which also spares anyone on a phone
 * hunting for the comma key.
 */
export function ListEditor({
  values,
  onChange,
  placeholder,
  addLabel = 'Add',
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim().replace(/\s+/g, ' ');
    if (!value) return;
    // Case-insensitive, so "Hilux" and "hilux" do not both end up in the list.
    if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setDraft('');
  };

  return (
    <div className="stack-sm">
      <div className="row-flex">
        <input
          className="input grow"
          value={draft}
          placeholder={placeholder}
          autoCapitalize="words"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-outline" disabled={!draft.trim()} onClick={add}>
          {addLabel}
        </button>
      </div>

      {values.length ? (
        <div className="chip-row chip-row-inline">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((entry) => entry !== value))}
            >
              {value} ✕
            </button>
          ))}
        </div>
      ) : (
        <p className="tiny muted">Nothing added yet.</p>
      )}
    </div>
  );
}
