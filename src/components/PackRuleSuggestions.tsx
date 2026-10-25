import { useMemo, useState } from 'react';
import { useToast } from './toastContext';
import { addLine } from '../domain/packlists';
import { suggestionsFor, type Suggestion } from '../domain/packRules';
import { formatQty } from '../domain/format';
import type { DestinationType, Item, PacklistLine } from '../db/types';

/**
 * The pack rules, offered on the list.
 *
 * One tap adds what a rule says is missing; "Not needed" puts it away for this
 * list on this phone. A dismissal remembers the amount asked, so if the crew
 * adds two more marquees the straps are asked about again.
 */
export function PackRuleSuggestions({
  packlistId,
  lines,
  items,
  destinationType,
  eventId,
}: {
  packlistId: string;
  lines: PacklistLine[];
  items: Map<string, Item>;
  destinationType: DestinationType | undefined;
  eventId?: string;
}) {
  const toast = useToast();
  const storageKey = `packRules:dismissed:${packlistId}`;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => readDismissed(storageKey));

  const suggestions = useMemo(
    () => suggestionsFor(lines, items, destinationType, eventId).filter((entry) => !dismissed.has(entry.key)),
    [lines, items, destinationType, eventId, dismissed],
  );
  if (!suggestions.length) return null;

  const add = async (entries: Suggestion[]) => {
    for (const entry of entries) await addLine(packlistId, entry.item.id, entry.qty);
    toast(entries.length === 1 ? `Added ${entries[0].item.name}` : `Added ${entries.length} items`);
  };

  const dismiss = (entry: Suggestion) => {
    const next = new Set(dismissed).add(entry.key);
    setDismissed(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Remembering is a convenience; the suggestion just comes back next time.
    }
  };

  return (
    // Folded away under the list: the lines to pack are the job, and these are
    // a second thought about them.
    <details className="card card-pad mt-3 no-print">
      <summary className="small strong">
        {suggestions.length === 1
          ? '1 thing usually goes with this list'
          : `${suggestions.length} things usually go with this list`}
      </summary>
      {suggestions.length > 1 ? (
        <div className="mt-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void add(suggestions)}>
            Add all
          </button>
        </div>
      ) : null}
      {suggestions.map((entry) => (
        <div key={entry.key} className="spread mt-2" style={{ alignItems: 'flex-start', gap: 8 }}>
          <span className="row-body">
            <span className="row-title">
              + {formatQty(entry.qty, entry.item.unit)} {entry.item.name}
            </span>
            <span className="row-sub">
              {entry.have ? `${entry.have} on the list, rules ask for ${entry.need}. ` : ''}
              {entry.because.join('. ')}
            </span>
          </span>
          <span className="btn-row" style={{ flexShrink: 0 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void add([entry])}>
              Add
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(entry)}>
              Not needed
            </button>
          </span>
        </div>
      ))}
    </details>
  );
}

function readDismissed(key: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
