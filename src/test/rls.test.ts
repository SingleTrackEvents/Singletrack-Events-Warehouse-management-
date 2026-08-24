import { describe, expect, it } from 'vitest';
import { freshDb, wireRow } from './pg';

/**
 * The row-level security policies, executed for real.
 *
 * These are the actual access control: the browser holds only a publishable
 * key, so anything these allow is allowed to anyone who cares to try. The
 * checks in the app only shape the UI. Until now they had never been run
 * anywhere.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111';
const VOLUNTEER = '22222222-2222-4222-8222-222222222222';
const EVENT = 'event-buffalo';
const MY_STATION = 'dest-aid-3';
const OTHER_STATION = 'dest-aid-4';

/** An admin with data in place, plus a volunteer scoped to one aid station. */
async function seeded() {
  const db = await freshDb();
  await db.addUser(ADMIN, 'chad@singletrack.com.au');
  await db.addUser(VOLUNTEER, 'tom@example.com');
  await db.actAs(ADMIN);
  await db.query(`select public.ensure_membership('Chad')`);

  await db.query('select public.push_records($1::jsonb)', [
    JSON.stringify([
      wireRow({ table_name: 'items', id: 'item-1' }),
      wireRow({ table_name: 'events', id: EVENT, event_id: EVENT }),
      wireRow({
        table_name: 'packlists', id: 'pl-mine',
        event_id: EVENT, destination_id: MY_STATION,
      }),
      wireRow({
        table_name: 'packlists', id: 'pl-theirs',
        event_id: EVENT, destination_id: OTHER_STATION,
      }),
    ]),
  ]);

  const invite = await db.query<{ token: string }>(
    `insert into public.invites (token, role, event_id, destination_id, label)
     values ('AAAA-BBBB', 'volunteer', $1, $2, 'Aid 3') returning token`,
    [EVENT, MY_STATION],
  );

  await db.actAs(VOLUNTEER);
  await db.query(`select public.redeem_invite($1, 'Tom Reilly')`, [invite.rows[0].token]);
  return db;
}

describe('what a volunteer can read', () => {
  it('sees their own aid station packlist', async () => {
    const db = await seeded();
    await db.enforceRls();
    const { rows } = await db.query<{ id: string }>(
      `select id from public.records where table_name = 'packlists'`,
    );
    expect(rows.map((r) => r.id)).toEqual(['pl-mine']);
    await db.close();
  });

  it('cannot see another aid station packlist', async () => {
    const db = await seeded();
    await db.enforceRls();
    const { rows } = await db.query(
      `select id from public.records where id = 'pl-theirs'`,
    );
    expect(rows).toHaveLength(0);
    await db.close();
  });

  it('never receives the stock catalogue', async () => {
    // A volunteer has no business holding the warehouse inventory.
    const db = await seeded();
    await db.enforceRls();
    const { rows } = await db.query(
      `select id from public.records where table_name = 'items'`,
    );
    expect(rows).toHaveLength(0);
    await db.close();
  });

  it('can still see the event itself, which has no destination', async () => {
    const db = await seeded();
    await db.enforceRls();
    const { rows } = await db.query(
      `select id from public.records where table_name = 'events'`,
    );
    expect(rows).toHaveLength(1);
    await db.close();
  });
});

describe('what a volunteer can write', () => {
  it('is refused a write to another aid station', async () => {
    const db = await seeded();
    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow({
        table_name: 'packlists', id: 'pl-theirs', rev: 9,
        updated_at: '2026-05-01T00:00:00.000Z',
        event_id: EVENT, destination_id: OTHER_STATION,
      })])],
    );
    expect(rows[0].push_records.refused).toBe(1);
    expect(rows[0].push_records.accepted).toBe(0);
    await db.close();
  });

  it('is refused a write to the stock catalogue', async () => {
    const db = await seeded();
    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow({ table_name: 'items', id: 'item-1', rev: 9 })])],
    );
    expect(rows[0].push_records.refused).toBe(1);
    await db.close();
  });

  it('cannot slip past the scope check by sending no scope at all', async () => {
    // The client supplies these columns, so a null scope must be denied rather
    // than treated as "applies everywhere".
    const db = await seeded();
    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow({
        table_name: 'packlists', id: 'pl-sneaky', rev: 1,
        event_id: null, destination_id: null,
      })])],
    );
    expect(rows[0].push_records.refused).toBe(1);
    await db.close();
  });

  it('can write its own aid station', async () => {
    const db = await seeded();
    const { rows } = await db.query<{ push_records: Record<string, number> }>(
      'select public.push_records($1::jsonb) as push_records',
      [JSON.stringify([wireRow({
        table_name: 'packlists', id: 'pl-mine', rev: 9,
        updated_at: '2026-05-01T00:00:00.000Z',
        event_id: EVENT, destination_id: MY_STATION,
      })])],
    );
    expect(rows[0].push_records.accepted).toBe(1);
    await db.close();
  });
});

describe('privilege boundaries', () => {
  it('will not let a volunteer promote themselves', async () => {
    const db = await seeded();
    await db.enforceRls();
    await db.query(`update public.memberships set role = 'admin' where user_id = $1`, [VOLUNTEER]);
    // The policy filters the row out rather than raising, so nothing changes.
    const { rows } = await db.query<{ role: string }>(
      'select role from public.memberships where user_id = $1',
      [VOLUNTEER],
    );
    expect(rows[0]?.role ?? 'volunteer').toBe('volunteer');
    await db.close();
  });

  it('will not let a volunteer read the invite tokens', async () => {
    const db = await seeded();
    await db.enforceRls();
    const { rows } = await db.query('select token from public.invites');
    expect(rows).toHaveLength(0);
    await db.close();
  });

  it('lets someone rename themselves without touching their role', async () => {
    const db = await seeded();
    await db.query(`select public.update_display_name('Thomas Reilly')`);
    const { rows } = await db.query<{ display_name: string; role: string }>(
      'select display_name, role from public.memberships where user_id = $1',
      [VOLUNTEER],
    );
    expect(rows[0].display_name).toBe('Thomas Reilly');
    expect(rows[0].role).toBe('volunteer');
    await db.close();
  });

  it('lets a brand new phone redeem an aid station invite under real privileges', async () => {
    // The volunteer's phone is a fresh anonymous user with no membership, and
    // it is subject to row-level security like any other client. Every earlier
    // redeem test ran as a superuser, so this path had never actually been
    // exercised the way a phone at an aid station exercises it.
    const db = await seeded();
    await db.actAs(ADMIN);
    const invite = await db.query<{ token: string }>(
      `insert into public.invites (token, role, event_id, destination_id, label)
       values ('CDEF-GHJK', 'volunteer', $1, $2, 'Aid 4') returning token`,
      [EVENT, OTHER_STATION],
    );

    const phone = '44444444-4444-4444-8444-444444444444';
    await db.addUser(phone, null);
    await db.actAs(phone);
    await db.enforceRls();

    const { rows } = await db.query<{ role: string; destination_id: string }>(
      `select role, destination_id from public.redeem_invite($1, 'Nigel')`,
      [invite.rows[0].token],
    );
    expect(rows[0].role).toBe('volunteer');
    expect(rows[0].destination_id).toBe(OTHER_STATION);
    await db.close();
  });

  it('matches an invite code whatever case it arrives in', async () => {
    const db = await seeded();
    const phone = '55555555-5555-4555-8555-555555555555';
    await db.addUser(phone, null);
    await db.actAs(phone);
    await db.enforceRls();

    const { rows } = await db.query<{ role: string }>(
      `select role from public.redeem_invite($1, 'Nigel')`,
      ['  aaaa-bbbb  '],
    );
    expect(rows[0].role).toBe('volunteer');
    await db.close();
  });

  it('lets an admin delete an invite', async () => {
    const db = await seeded();
    await db.actAs(ADMIN);
    await db.enforceRls();

    const { rows } = await db.query(
      `delete from public.invites where token = 'AAAA-BBBB' returning id`,
    );
    expect(rows).toHaveLength(1);
    const left = await db.query('select id from public.invites');
    expect(left.rows).toHaveLength(0);
    await db.close();
  });

  it('deletes nothing for a volunteer, and says nothing about it', async () => {
    const db = await seeded();
    await db.enforceRls();

    // The point of the test. Row-level security filters rather than refuses: the
    // statement succeeds, touches no row and raises nothing. An adapter that
    // only checks for an error reports a delete that never happened, which is
    // exactly how a deleted invite stayed on the list.
    const { rows } = await db.query(
      `delete from public.invites where token = 'AAAA-BBBB' returning id`,
    );
    expect(rows).toHaveLength(0);

    await db.actAs(ADMIN);
    const survived = await db.query('select id from public.invites');
    expect(survived.rows).toHaveLength(1);
    await db.close();
  });

  it('refuses a revoked invite', async () => {
    const db = await seeded();
    await db.actAs(ADMIN);
    await db.query(`update public.invites set revoked_at = now() where token = 'AAAA-BBBB'`);
    const third = '33333333-3333-4333-8333-333333333333';
    await db.addUser(third, 'late@example.com');
    await db.actAs(third);

    await expect(db.query(`select public.redeem_invite('AAAA-BBBB', 'Late')`)).rejects.toThrow(
      /revoked/i,
    );
    await db.close();
  });
});
