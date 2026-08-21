-- =====================================================================
-- SingleTrack Events — Warehouse: Supabase schema
--
-- Run this once, whole, in the Supabase SQL editor.
-- It is written to be re-runnable: running it twice changes nothing.
--
-- The app is offline-first and does all its querying locally, so the
-- server is a sync log rather than a query surface: one generic table of
-- rows keyed by (table_name, id), with the event and destination pulled
-- out as columns purely so row-level security can scope on them.
--
-- Security rests entirely on the policies below, because the browser
-- holds only a publishable key. Read them as the real access control;
-- the checks in the app are a courtesy to the UI.
-- =====================================================================

-- ---------------------------------------------------------------- tables --

-- Who a signed-in user is, and what they may reach. One row per user.
create table if not exists public.memberships (
  user_id        uuid primary key references auth.users on delete cascade,
  role           text not null check (role in ('admin', 'crew', 'driver', 'volunteer')),
  -- Null scope means unrestricted. A volunteer is pinned to one destination.
  event_id       text,
  destination_id text,
  display_name   text not null default '',
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- Invite tokens. A volunteer scans one and becomes a scoped guest.
create table if not exists public.invites (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique,
  role           text not null check (role in ('admin', 'crew', 'driver', 'volunteer')),
  event_id       text,
  destination_id text,
  label          text not null default '',
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  used_count     integer not null default 0
);

-- Every synced row from the app.
create table if not exists public.records (
  table_name     text not null,
  -- Text, not uuid: the app's ids are uuids but need not be forever.
  id             text not null,
  data           jsonb not null,
  rev            integer not null,
  updated_at     timestamptz not null,
  deleted_at     timestamptz,
  device_id      text,
  -- Denormalised out of `data` so policies can filter without parsing json.
  event_id       text,
  destination_id text,
  -- Monotonic; the client's pull cursor.
  seq            bigint generated always as identity,
  primary key (table_name, id)
);

create index if not exists records_seq_idx on public.records (seq);
create index if not exists records_event_idx on public.records (event_id);
create index if not exists invites_token_idx on public.invites (token);

-- ------------------------------------------------------------- helpers ----

-- The caller's role, or null if they have none or it has lapsed.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.memberships
  where user_id = auth.uid()
    and (expires_at is null or expires_at > now())
$$;

create or replace function public.my_event() returns text
language sql stable security definer set search_path = public as $$
  select event_id from public.memberships
  where user_id = auth.uid()
    and (expires_at is null or expires_at > now())
$$;

create or replace function public.my_destination() returns text
language sql stable security definer set search_path = public as $$
  select destination_id from public.memberships
  where user_id = auth.uid()
    and (expires_at is null or expires_at > now())
$$;

-- Does the caller's scope admit this row?
--
-- Deliberately strict: a scoped user is denied a row whose own scope is null,
-- because the client supplies these columns and could otherwise send nulls to
-- slip past the check. An unscoped membership (admin, crew) still sees all.
create or replace function public.row_in_scope(
  p_table text, p_event text, p_destination text
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m_event text := public.my_event();
  m_dest  text := public.my_destination();
begin
  if m_event is null and m_dest is null then
    return true;
  end if;

  -- Warehouse-wide reference data carries no event; which roles may see it at
  -- all is decided by can_read_table / can_write_table, not here.
  if m_event is not null then
    if p_event is null or p_event <> m_event then
      return false;
    end if;
  end if;

  -- A destination only means something for these tables. The event row itself
  -- has none and must stay readable to a volunteer scoped to one aid station.
  if m_dest is not null and p_table in
     ('destinations', 'packlists', 'packlistLines', 'containers', 'loadStops') then
    if p_destination is null or p_destination <> m_dest then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- Which tables a role may write. Mirrors writableTables() in the app.
create or replace function public.can_write_table(p_role text, p_table text)
returns boolean language sql immutable as $$
  select case p_role
    when 'admin' then true
    when 'crew'  then true
    when 'driver' then p_table in ('loads', 'loadStops', 'packlists', 'packlistLines')
    when 'volunteer' then p_table in ('packlists', 'packlistLines')
    else false
  end
$$;

-- Which tables a role may read. A volunteer must never receive the
-- warehouse catalogue — they only need their own packlist.
create or replace function public.can_read_table(p_role text, p_table text)
returns boolean language sql immutable as $$
  select case p_role
    when 'volunteer' then p_table in ('events', 'destinations', 'packlists', 'packlistLines', 'containers')
    when 'driver' then p_table <> 'settings'
    when 'crew' then p_table <> 'settings'
    when 'admin' then p_table <> 'settings'
    else false
  end
$$;

-- ------------------------------------------------------------------ RLS ---

alter table public.records enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
using (
  public.my_role() is not null
  and public.can_read_table(public.my_role(), table_name)
  and public.row_in_scope(table_name, event_id, destination_id)
);

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
with check (
  public.my_role() is not null
  and public.can_write_table(public.my_role(), table_name)
  and public.row_in_scope(table_name, event_id, destination_id)
);

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
using (
  public.my_role() is not null
  and public.can_write_table(public.my_role(), table_name)
  and public.row_in_scope(table_name, event_id, destination_id)
)
with check (
  public.can_write_table(public.my_role(), table_name)
  and public.row_in_scope(table_name, event_id, destination_id)
);

-- Nobody deletes rows: the app tombstones with deleted_at so removals sync.
-- Leaving out a delete policy means every delete is denied.

drop policy if exists memberships_select_self on public.memberships;
create policy memberships_select_self on public.memberships for select to authenticated
using (user_id = auth.uid() or public.my_role() = 'admin');

drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships for all to authenticated
using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- Redeeming an invite goes through redeem_invite() below, which is
-- security definer, so invites stay unreadable to everyone but admins.

-- ------------------------------------------------------------ bootstrap ---

-- The first person to sign in becomes the admin; everyone after needs an
-- invite. Returns the caller's membership either way.
create or replace function public.ensure_membership(p_display_name text default '')
returns public.memberships
language plpgsql security definer set search_path = public as $$
declare
  existing public.memberships;
  admin_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into existing from public.memberships where user_id = auth.uid();
  if found then
    if p_display_name <> '' and existing.display_name = '' then
      update public.memberships set display_name = p_display_name
      where user_id = auth.uid() returning * into existing;
    end if;
    return existing;
  end if;

  select count(*) into admin_count from public.memberships where role = 'admin';
  if admin_count > 0 then
    raise exception 'No access yet — ask an admin for an invite';
  end if;

  insert into public.memberships (user_id, role, display_name)
  values (auth.uid(), 'admin', coalesce(nullif(p_display_name, ''), 'Admin'))
  returning * into existing;
  return existing;
end;
$$;

-- Turn an invite token into a scoped membership for the caller.
create or replace function public.redeem_invite(p_token text, p_display_name text)
returns public.memberships
language plpgsql security definer set search_path = public as $$
declare
  found_invite public.invites;
  created public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'Please enter your name so the crew know who you are';
  end if;

  select * into found_invite from public.invites
  where upper(token) = upper(trim(p_token));

  if not found then
    raise exception 'That invite code was not recognised';
  end if;
  if found_invite.revoked_at is not null then
    raise exception 'That invite has been revoked';
  end if;
  if found_invite.expires_at is not null and found_invite.expires_at <= now() then
    raise exception 'That invite has expired';
  end if;

  insert into public.memberships
    (user_id, role, event_id, destination_id, display_name, expires_at)
  values
    (auth.uid(), found_invite.role, found_invite.event_id,
     found_invite.destination_id, trim(p_display_name), found_invite.expires_at)
  on conflict (user_id) do update set
    role = excluded.role,
    event_id = excluded.event_id,
    destination_id = excluded.destination_id,
    display_name = excluded.display_name,
    expires_at = excluded.expires_at
  returning * into created;

  update public.invites set used_count = used_count + 1 where id = found_invite.id;
  return created;
end;
$$;

-- ----------------------------------------------------------------- push ---

-- Upsert a batch, keeping whichever copy of each row is newer.
--
-- Runs as definer so it can report per-row outcomes instead of failing the
-- whole statement, which means every check RLS would have made is repeated
-- here by hand. Change one and you must change the other.
create or replace function public.push_records(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  role text := public.my_role();
  existing public.records;
  accepted integer := 0;
  stale integer := 0;
  refused integer := 0;
  conflicts jsonb := '[]'::jsonb;
  max_seq bigint := 0;
begin
  if role is null then
    raise exception 'No access yet — ask an admin for an invite';
  end if;

  for item in select * from jsonb_array_elements(p_rows) loop
    if not public.can_write_table(role, item->>'table_name')
       or not public.row_in_scope(
            item->>'table_name', item->>'event_id', item->>'destination_id') then
      refused := refused + 1;
      continue;
    end if;

    select * into existing from public.records
    where table_name = item->>'table_name' and id = item->>'id';

    -- Newest revision wins; ties break on updated_at. Same rule as the client.
    if found and (
        existing.rev > (item->>'rev')::integer
        or (existing.rev = (item->>'rev')::integer
            and existing.updated_at >= (item->>'updated_at')::timestamptz)
    ) then
      stale := stale + 1;
      conflicts := conflicts || jsonb_build_object(
        'table_name', existing.table_name,
        'data', existing.data
      );
      continue;
    end if;

    insert into public.records
      (table_name, id, data, rev, updated_at, deleted_at, device_id, event_id, destination_id)
    values (
      item->>'table_name',
      item->>'id',
      item->'data',
      (item->>'rev')::integer,
      (item->>'updated_at')::timestamptz,
      nullif(item->>'deleted_at', '')::timestamptz,
      item->>'device_id',
      nullif(item->>'event_id', ''),
      nullif(item->>'destination_id', '')
    )
    on conflict (table_name, id) do update set
      data = excluded.data,
      rev = excluded.rev,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      device_id = excluded.device_id,
      event_id = excluded.event_id,
      destination_id = excluded.destination_id,
      seq = nextval(pg_get_serial_sequence('public.records', 'seq'));

    accepted := accepted + 1;
  end loop;

  select coalesce(max(seq), 0) into max_seq from public.records;

  return jsonb_build_object(
    'accepted', accepted,
    'stale', stale,
    'refused', refused,
    'conflicts', conflicts,
    'cursor', max_seq
  );
end;
$$;

revoke all on function public.push_records(jsonb) from public;
grant execute on function public.push_records(jsonb) to authenticated;
grant execute on function public.ensure_membership(text) to authenticated;
grant execute on function public.redeem_invite(text, text) to authenticated;

-- Older deployments had a laxer scope check; remove it so nothing calls it.
drop function if exists public.in_my_scope(text, text);
