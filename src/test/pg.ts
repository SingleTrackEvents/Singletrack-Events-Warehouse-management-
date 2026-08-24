import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * A real Postgres to run the schema against.
 *
 * Two SQL bugs reached production because the schema could only be checked by
 * deploying it. PGlite is Postgres compiled to WebAssembly, so the actual
 * schema file — policies, functions and all — can be executed here in-process.
 *
 * Supabase supplies `auth.uid()` and `auth.users`; those are stubbed so the
 * schema loads unchanged, with the current user switchable per test.
 */

const SUPABASE_STUBS = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id    uuid primary key,
    email text
  );

  -- Stands in for Supabase's auth.uid(), switchable with actAs().
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated;
    end if;
  end $$;
`;

/**
 * Grants Supabase gives the `authenticated` role by default.
 *
 * Applied after the schema so the role can reach the tables at all — without
 * them every policy test would pass for the wrong reason.
 */
const GRANTS = `
  grant usage on schema public to authenticated;
  grant select, insert, update on public.records to authenticated;
  grant select, insert, update, delete on public.memberships to authenticated;
  grant select, insert, update, delete on public.invites to authenticated;
`;

export interface TestDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Become this user for subsequent statements. */
  actAs(userId: string | null): Promise<void>;
  /** Insert an auth user and return its id. Anonymous users have no email. */
  addUser(id: string, email: string | null): Promise<string>;
  /** Drop superuser privileges so row-level security actually applies. */
  enforceRls(): Promise<void>;
  close(): Promise<void>;
}

/** Boot a database with the project's schema applied. */
export async function freshDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUBS);
  await pg.exec(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  await pg.exec(GRANTS);

  return {
    query: async <T>(sql: string, params?: unknown[]) =>
      (await pg.query(sql, params as never[])) as { rows: T[] },
    actAs: async (userId) => {
      await pg.query(`select set_config('test.uid', $1, false)`, [userId ?? '']);
    },
    addUser: async (id, email) => {
      await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      return id;
    },
    // Superusers bypass RLS entirely, so policy tests must drop to a plain role.
    enforceRls: async () => {
      await pg.exec('set role authenticated');
    },
    close: () => pg.close(),
  };
}

/** Shorthand for building the JSON payload push_records expects. */
export function wireRow(overrides: Record<string, unknown> = {}) {
  return {
    table_name: 'items',
    id: 'item-1',
    data: { id: 'item-1', name: 'Water cube' },
    rev: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    device_id: 'device-a',
    event_id: null,
    destination_id: null,
    ...overrides,
  };
}
