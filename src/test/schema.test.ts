import { describe, expect, it } from 'vitest';
import { freshDb, wireRow } from './pg';

const ADMIN = '11111111-1111-4111-8111-111111111111';

async function adminDb() {
  const db = await freshDb();
  await db.addUser(ADMIN, 'chad@singletrack.com.au');
  await db.actAs(ADMIN);
  await db.query(`select public.ensure_membership('Chad')`);
  return db;
}

describe('push_records', () => {
  it('stores a new row', async () => {
    const db = await adminDb();
    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow()])],
    );

    expect(rows[0].push_records.accepted).toBe(1);
    const stored = await db.query('select * from public.records');
    expect(stored.rows).toHaveLength(1);
    await db.close();
  });

  it('updates a row that already exists', async () => {
    // The case that failed in production with
    // 'column "seq" can only be updated to DEFAULT': the first push of a
    // record worked and every later change to it was rejected.
    const db = await adminDb();
    await db.query('select public.push_records($1::jsonb)', [JSON.stringify([wireRow()])]);

    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow({ rev: 2, updated_at: '2026-01-02T00:00:00.000Z' })])],
    );

    expect(rows[0].push_records.accepted).toBe(1);
    const stored = await db.query<{ rev: number }>('select rev from public.records');
    expect(stored.rows[0].rev).toBe(2);
    await db.close();
  });

  it('moves an updated row to the end of the queue so other devices see it', async () => {
    // Without this a device already past the row's original position would
    // never be told it changed.
    const db = await adminDb();
    await db.query('select public.push_records($1::jsonb)', [
      JSON.stringify([wireRow({ id: 'a' }), wireRow({ id: 'b' })]),
    ]);
    const before = await db.query<{ id: string; seq: string }>(
      'select id, seq from public.records order by seq',
    );

    await db.query('select public.push_records($1::jsonb)', [
      JSON.stringify([wireRow({ id: 'a', rev: 2, updated_at: '2026-01-03T00:00:00.000Z' })]),
    ]);
    const after = await db.query<{ id: string; seq: string }>(
      'select id, seq from public.records order by seq',
    );

    expect(before.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(after.rows.map((r) => r.id)).toEqual(['b', 'a']);
    await db.close();
  });

  it('keeps the newer copy when an older revision is pushed', async () => {
    const db = await adminDb();
    await db.query('select public.push_records($1::jsonb)', [
      JSON.stringify([wireRow({ rev: 5, updated_at: '2026-02-01T00:00:00.000Z' })]),
    ]);

    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow({ rev: 2 })])],
    );

    expect(rows[0].push_records.stale).toBe(1);
    expect(rows[0].push_records.accepted).toBe(0);
    const stored = await db.query<{ rev: number }>('select rev from public.records');
    expect(stored.rows[0].rev).toBe(5);
    await db.close();
  });

  it('carries a tombstone so deletions replicate', async () => {
    const db = await adminDb();
    await db.query('select public.push_records($1::jsonb)', [
      JSON.stringify([wireRow({ deleted_at: '2026-03-01T00:00:00.000Z' })]),
    ]);
    const stored = await db.query<{ deleted_at: Date | null }>(
      'select deleted_at from public.records',
    );
    expect(stored.rows[0].deleted_at).not.toBeNull();
    await db.close();
  });
});

describe('bootstrap', () => {
  it('makes the first person to sign in the admin', async () => {
    const db = await adminDb();
    const { rows } = await db.query<{ role: string }>('select role from public.memberships');
    expect(rows[0].role).toBe('admin');
    await db.close();
  });

  it('refuses everyone after that until they are invited', async () => {
    const db = await adminDb();
    const second = '22222222-2222-4222-8222-222222222222';
    await db.addUser(second, 'tom@singletrack.com.au');
    await db.actAs(second);

    await expect(db.query(`select public.ensure_membership('Tom')`)).rejects.toThrow(/no access/i);
    await db.close();
  });
});
