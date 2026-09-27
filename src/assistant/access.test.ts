import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create } from '../db/repo';
import { MockBackend, resetMockServer } from '../sync/mock';
import { ADMIN_TABLES, CREW_TABLES, can, readableTable, writableTables } from '../sync/permissions';
import { applyRemote, collectOutbox, resetCursor, runSync } from '../sync/engine';
import type { Session } from '../sync/types';
import { UNSCOPED } from '../sync/types';

/**
 * The assistant's notes are admin-only, on the phone and on the server.
 * These run the client rules and the stand-in server; the real policies are
 * exercised against Postgres in src/test/rls.test.ts.
 */

const backend = new MockBackend();

const session = (role: Session['role']): Session => ({
  userId: `u-${role}`, displayName: role, email: `${role}@example.com`, role, scope: UNSCOPED,
  token: `t-${role}`, expiresAt: null, guest: false,
});

beforeEach(async () => {
  await resetMockServer();
  resetCursor();
});

describe('who may use the assistant', () => {
  it('is an admin, and nobody else', () => {
    expect(can(session('admin'), 'assistant:use')).toBe(true);
    expect(can(session('crew'), 'assistant:use')).toBe(false);
    expect(can(session('driver'), 'assistant:use')).toBe(false);
    expect(can(session('volunteer'), 'assistant:use')).toBe(false);
  });

  it('keeps the notes table out of every other role’s reach', () => {
    expect(ADMIN_TABLES).toContain('assistantNotes');
    expect(readableTable('admin', 'assistantNotes')).toBe(true);
    expect(readableTable('crew', 'assistantNotes')).toBe(false);
    expect(readableTable('crew', 'items')).toBe(true);
    expect(readableTable('volunteer', 'items')).toBe(false);
    expect(CREW_TABLES).not.toContain('assistantNotes');
    expect(CREW_TABLES).toContain('items');
    expect(writableTables(session('crew'))).toEqual(CREW_TABLES);
    expect(writableTables(session('admin'))).toBe('all');
  });
});

describe('on the stand-in server', () => {
  it('never sends a note to crew, and refuses one they try to push', async () => {
    const admin = await backend.completeEmailSignIn('email:admin@singletrack.test');
    await create(db.assistantNotes, {
      text: 'No power at the carpark.', eventId: null, destinationType: null, source: 'written',
    });
    const pushed = await runSync(backend, admin);
    expect(pushed.pushed).toBe(1);

    // Crew: a note written on their phone never leaves it, and the server's
    // notes never arrive.
    const crew = session('crew');
    await db.assistantNotes.clear();
    await create(db.assistantNotes, {
      text: 'Written by crew.', eventId: null, destinationType: null, source: 'written',
    });
    expect(Object.keys(await collectOutbox(crew))).not.toContain('assistantNotes');

    resetCursor();
    const pulled = await backend.pull(crew, null);
    expect(pulled.changes.assistantNotes).toBeUndefined();
    const applied = await applyRemote(pulled.changes);
    expect(applied.applied).toBe(0);

    const refused = await backend.push(crew, {
      assistantNotes: [{ ...(await db.assistantNotes.toArray())[0] }],
    });
    expect(refused.refused).toBe(1);
    expect(refused.accepted).toBe(0);
  });
});
