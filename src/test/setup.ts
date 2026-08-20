import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db } from '../db/db';

/**
 * A minimal localStorage, since the tests run in the node environment.
 *
 * Without it the sync cursor and session helpers silently no-op, which would
 * leave the parts of sync that persist across reloads untested — exactly the
 * parts most likely to break.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

// Each test starts on an empty database. Deleting and reopening is faster than
// clearing fifteen tables and guarantees no leftover indexes.
beforeEach(async () => {
  localStorage.clear();
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
});
