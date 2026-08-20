import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db } from '../db/db';

// Each test starts on an empty database. Deleting and reopening is faster than
// clearing fifteen tables and guarantees no leftover indexes.
beforeEach(async () => {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
});
