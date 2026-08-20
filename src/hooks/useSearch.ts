import { useEffect, useMemo, useState } from 'react';

/** Debounced text filter, so typing does not re-query on every keystroke. */
export function useDebounced<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Case-insensitive search across a set of fields, matching every whitespace
 * separated term. "water cube" finds "Water cube 20L" but not "Water jug".
 */
export function useSearch<T>(
  rows: T[] | undefined,
  query: string,
  fields: (row: T) => string[],
): T[] {
  const debounced = useDebounced(query);
  return useMemo(() => {
    if (!rows) return [];
    const terms = debounced.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return rows;
    return rows.filter((row) => {
      const haystack = fields(row).join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    // `fields` is a fresh closure on every render, so including it would defeat
    // the memo entirely; the rows and the query are what actually drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, debounced]);
}
