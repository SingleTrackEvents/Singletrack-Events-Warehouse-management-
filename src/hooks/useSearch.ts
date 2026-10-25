import { useEffect, useMemo, useState } from 'react';
import { searchVariants } from '../domain/importMatch';

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
 * The crew's own words count too: "esky" finds the coolers. The list lives
 * with the import matcher in `importMatch.ts`, so both read names alike.
 */
export function useSearch<T>(
  rows: T[] | undefined,
  query: string,
  fields: (row: T) => string[],
): T[] {
  const debounced = useDebounced(query);
  return useMemo(() => {
    if (!rows) return [];
    // Each way of saying the query ("zip ties" is also "cable ties"), split
    // into terms once rather than once per row.
    const variants = searchVariants(debounced)
      .map((variant) => variant.split(/\s+/).filter(Boolean))
      .filter((terms) => terms.length);
    if (!variants.length) return rows;
    return rows.filter((row) => {
      const haystack = fields(row).join(' ').toLowerCase();
      return variants.some((terms) => terms.every((term) => haystack.includes(term)));
    });
    // `fields` is a fresh closure on every render, so including it would defeat
    // the memo entirely; the rows and the query are what actually drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, debounced]);
}
