import { SYNCED_TABLES } from '../db/db';
import type { TableName } from '../db/db';
import type { Access, Role, Scope, Session } from './types';
import { ACCESS_KEYS, ACCESS_OPTIONS, UNSCOPED } from './types';

/**
 * Who may do what.
 *
 * These rules run on the client so the UI can hide what someone cannot do, and
 * the same table is meant to be mirrored by row-level security on the backend.
 * The client copy is a courtesy; the server copy is the real boundary. Never
 * treat a passing check here as proof that a write is safe.
 */

/** Every distinct thing a person can attempt. */
export type Action =
  // Catalogue
  | 'item:read'
  | 'item:write'
  | 'item:archive'
  | 'stock:adjust'
  // Events and destinations
  | 'event:read'
  | 'event:create'
  | 'event:write'
  | 'event:delete'
  // Packlists
  | 'packlist:read'
  | 'packlist:pack'
  | 'packlist:receive'
  | 'packlist:manage'
  // Transport
  | 'load:read'
  | 'load:manage'
  | 'load:deliver'
  // Back of house
  | 'stocktake:read'
  | 'stocktake:manage'
  | 'template:manage'
  // Administration
  | 'member:manage'
  | 'data:export'
  | 'data:wipe'
  // The packing assistant: running checks and editing what it remembers
  | 'assistant:use'
  // The shopping list: adding lines, ticking them off, booking them into stock
  | 'shopping:manage'
  // The food plan: race projections and per-station quantities
  | 'food:plan';

/**
 * Grants per role.
 *
 * Written out in full rather than derived by inheritance: a table you can read
 * top to bottom is worth more here than clever composition, because a mistake
 * is a security hole rather than a bug.
 */
const GRANTS: Record<Role, Action[]> = {
  admin: [
    'item:read', 'item:write', 'item:archive', 'stock:adjust',
    'event:read', 'event:create', 'event:write', 'event:delete',
    'packlist:read', 'packlist:pack', 'packlist:receive', 'packlist:manage',
    'load:read', 'load:manage', 'load:deliver',
    'stocktake:read', 'stocktake:manage', 'template:manage',
    'member:manage', 'data:export', 'data:wipe',
    'assistant:use', 'shopping:manage', 'food:plan',
  ],
  crew: [
    'item:read', 'item:write', 'stock:adjust',
    'event:read', 'event:create', 'event:write',
    'packlist:read', 'packlist:pack', 'packlist:receive', 'packlist:manage',
    'load:read', 'load:manage', 'load:deliver',
    'stocktake:read', 'stocktake:manage', 'template:manage',
    'data:export', 'shopping:manage', 'food:plan',
  ],
  driver: [
    'item:read',
    'event:read',
    'packlist:read',
    'load:read', 'load:deliver',
  ],
  volunteer: [
    'event:read',
    'packlist:read', 'packlist:receive',
  ],
};

/**
 * What each tick box on an invite grants.
 *
 * Every account may read the event and the packlists its scope admits, so
 * those come with any set of boxes. Packing, stocktakes and templates all need
 * the catalogue to make sense of, so they bring it with them.
 */
const BASE_ACTIONS: Action[] = ['event:read', 'packlist:read'];

const ACCESS_ACTIONS: Record<Access, Action[]> = {
  receive: ['packlist:receive'],
  pack: ['packlist:pack', 'packlist:manage', 'packlist:receive', 'item:read'],
  deliver: ['load:read', 'load:deliver'],
  loads: ['load:read', 'load:manage', 'load:deliver'],
  catalogue: ['item:read'],
  stock: ['item:read', 'item:write', 'stock:adjust'],
  food: ['food:plan'],
  events: ['event:write', 'event:create'],
  shopping: ['shopping:manage'],
  stocktakes: ['item:read', 'stocktake:read', 'stocktake:manage'],
  templates: ['item:read', 'template:manage'],
};

/**
 * The boxes each role starts with on the invite sheet.
 *
 * Chosen so that leaving them as they are gives exactly what the role gave
 * before boxes existed. An invite whose boxes match its preset is stored as
 * the plain role, so nothing about an ordinary invite changes.
 */
export function presetAccess(role: Role, scope: Scope = UNSCOPED): Access[] {
  switch (role) {
    case 'volunteer':
      return ['receive'];
    case 'driver':
      return ['deliver', 'catalogue'];
    case 'crew':
    case 'admin': {
      const all = ACCESS_KEYS;
      return scope.eventId ? all.filter((key) => !isWarehouseAccess(key)) : [...all];
    }
  }
}

export function isWarehouseAccess(key: Access): boolean {
  return Boolean(ACCESS_OPTIONS.find((option) => option.key === key)?.warehouse);
}

/**
 * Tidy a set of boxes for saving: known keys only, warehouse boxes dropped
 * for an invite pinned to one event (the server would refuse them anyway),
 * and null when it is just the role's preset.
 */
export function normaliseAccess(role: Role, scope: Scope, picked: Access[]): Access[] | null {
  const kept = ACCESS_KEYS.filter(
    (key) => picked.includes(key) && !(scope.eventId && isWarehouseAccess(key)),
  );
  const preset = presetAccess(role, scope);
  const same = kept.length === preset.length && preset.every((key) => kept.includes(key));
  return same ? null : kept;
}

/** True when the account runs on ticked boxes rather than its role's rules. */
function customised(session: Session): session is Session & { access: Access[] } {
  return session.role !== 'admin' && Array.isArray(session.access);
}

/** The boxes in effect for a session, whether ticked or from its role. */
export function accessOf(session: Session): Access[] {
  return customised(session) ? session.access : presetAccess(session.role, session.scope);
}

function grantsFor(session: Session): Action[] {
  if (!customised(session)) return GRANTS[session.role];
  return [...new Set([...BASE_ACTIONS, ...session.access.flatMap((key) => ACCESS_ACTIONS[key])])];
}

/**
 * Tables each box lets an account read and write. Mirrors access_reads and
 * access_writes in supabase/schema.sql.
 */
const BASE_READS: TableName[] = ['events', 'destinations', 'packlists', 'packlistLines', 'containers'];

const ACCESS_READS: Record<Access, TableName[]> = {
  receive: [],
  pack: ['items', 'categories', 'templates', 'templateLines'],
  deliver: ['loads', 'loadStops'],
  loads: ['loads', 'loadStops'],
  catalogue: ['items', 'categories', 'templates', 'templateLines'],
  stock: ['items', 'categories', 'templates', 'templateLines', 'movements'],
  food: ['races', 'consumptionLines'],
  events: [],
  shopping: ['shoppingLines'],
  stocktakes: ['items', 'categories', 'templates', 'templateLines', 'movements', 'stocktakes', 'stocktakeCounts'],
  templates: ['items', 'categories', 'templates', 'templateLines'],
};

const ACCESS_WRITES: Record<Access, TableName[]> = {
  receive: ['packlists', 'packlistLines'],
  pack: ['packlists', 'packlistLines', 'containers'],
  deliver: ['loads', 'loadStops', 'packlists', 'packlistLines'],
  loads: ['loads', 'loadStops'],
  catalogue: [],
  stock: ['items', 'categories', 'movements'],
  food: ['races', 'consumptionLines'],
  events: ['events', 'destinations'],
  shopping: ['shoppingLines'],
  stocktakes: ['items', 'movements', 'stocktakes', 'stocktakeCounts'],
  templates: ['templates', 'templateLines'],
};

/** Warehouse-wide tables a scoped account may still read, the catalogue mostly. */
export const REFERENCE_TABLES: TableName[] = ['items', 'categories', 'templates', 'templateLines'];

/** Can this session read the catalogue and templates even when pinned to an event? */
export function readsReference(session: Session, table: TableName): boolean {
  if (!REFERENCE_TABLES.includes(table)) return false;
  if (!customised(session)) return session.role !== 'volunteer';
  return session.access.some((key) => ACCESS_READS[key].includes(table));
}

/** Can this session be sent rows from this table at all? */
export function readableTableFor(session: Session, table: TableName): boolean {
  if (!customised(session)) return readableTable(session.role, table);
  return BASE_READS.includes(table) || session.access.some((key) => ACCESS_READS[key].includes(table));
}

/**
 * Actions that belong to the warehouse rather than to any one event.
 *
 * An invite can pin crew or a driver to a single event, and that pin has to
 * mean something beyond which races appear in a list. The stock ledger, the
 * stocktakes, the templates and the backup are shared by every event, so a
 * person given one race has no business changing them; nor can they start a
 * new event, since a new event is by definition outside the one they were
 * given. They keep the catalogue to read, because a packlist is meaningless
 * without it.
 */
const WAREHOUSE_ACTIONS: Action[] = [
  'item:write', 'item:archive', 'stock:adjust',
  'event:create', 'event:delete',
  'stocktake:read', 'stocktake:manage', 'template:manage',
  'member:manage', 'data:export', 'data:wipe',
  'assistant:use',
];

/**
 * Tables only an admin may read or write.
 *
 * The assistant's notes decide what it tells the crew about every list it
 * checks, so they belong with inviting people rather than with packing. Crew
 * never receive them; the server refuses the rows and the mock mirrors it.
 */
export const ADMIN_TABLES: TableName[] = ['assistantNotes'];

/**
 * Tables for the people who run the warehouse and nobody else.
 *
 * The shopping list is what the crew are short of and where they buy it.
 * Drivers and volunteers have no part in that, and a list of the warehouse's
 * gaps is not something to hand to every phone at an aid station. The server
 * refuses the rows to those roles and the mock mirrors it.
 */
export const CREW_ONLY_TABLES: TableName[] = ['shoppingLines'];

/** Can this role be sent rows from this table at all? */
export function readableTable(role: Role, table: TableName): boolean {
  if (table === 'settings') return false;
  if (ADMIN_TABLES.includes(table)) return role === 'admin';
  if (CREW_ONLY_TABLES.includes(table)) return role === 'admin' || role === 'crew';
  if (role === 'volunteer') {
    return ['events', 'destinations', 'packlists', 'packlistLines', 'containers'].includes(table);
  }
  return true;
}

/** A reference to the thing being acted on, for scope checks. */
export interface Target {
  eventId?: string | null;
  destinationId?: string | null;
}

/**
 * Can this session take this action?
 *
 * With no session the app is in offline-only mode — one device, no accounts —
 * and everything is permitted, exactly as it behaved before sync existed.
 *
 * A session pinned to an event is refused the warehouse-wide actions outright,
 * whether or not a target is named: the check that hides a tab and the check
 * that guards a route must agree, and neither has a row to point at.
 */
export function can(session: Session | null, action: Action, target?: Target): boolean {
  if (!session) return true;
  if (isExpired(session)) return false;
  if (!grantsFor(session).includes(action)) return false;
  if (isEventScoped(session) && WAREHOUSE_ACTIONS.includes(action)) return false;
  return inScope(session.scope, target);
}

/** True for a session pinned to one event, whatever its role. */
export function isEventScoped(session: Session | null): boolean {
  return Boolean(session?.scope.eventId);
}

/**
 * Can this session see this row at all?
 *
 * The lists read straight from the local database, and the local database
 * holds whatever this phone was seeded with or synced before the sign-in, so
 * an event the server would never send can still be sitting there. Every list
 * of events, packlists or loads runs through here so that what is on the
 * screen matches what the account was given, not what the phone happens to
 * hold.
 */
export function reachable(session: Session | null, target: Target): boolean {
  if (!session) return true;
  if (isExpired(session)) return false;
  return inScope(session.scope, target);
}

/** True when the target falls inside what the session may reach. */
export function inScope(scope: Scope, target?: Target): boolean {
  if (!target) return true;
  if (scope.eventId && target.eventId && target.eventId !== scope.eventId) return false;
  if (scope.destinationId && target.destinationId && target.destinationId !== scope.destinationId) {
    return false;
  }
  return true;
}

export function isExpired(session: Session, now = new Date()): boolean {
  if (!session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

/**
 * True for someone whose whole job is one aid station.
 *
 * A volunteer pinned to a destination has exactly one packlist to look at and
 * nothing to do anywhere else in the app. Showing them a warehouse they cannot
 * reach, a backup they must not take and a stocktake they cannot run is not
 * security — the scope rules already stop all of it — but it is clutter on a
 * phone held in one hand at an aid station, and clutter is how people end up
 * tapping the wrong thing.
 */
export function isStationOnly(session: Session | null): boolean {
  if (!session?.scope.destinationId) return false;
  // A volunteer given the food plan as well has somewhere else to go.
  return accessOf(session).every((key) => key === 'receive');
}

/** Position in the authority order; lower is more powerful. */
export function roleRank(role: Role): number {
  return ['admin', 'crew', 'driver', 'volunteer'].indexOf(role);
}

/** True when `role` is at least as powerful as `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return roleRank(role) <= roleRank(minimum);
}

/**
 * Fields a role may change, per table.
 *
 * A volunteer at an aid station records what physically turned up; they must
 * not be able to rewrite what was required or what was packed, because that
 * would quietly erase the evidence of a short delivery. Nor may they move the
 * packlist through its statuses — that is the warehouse's and the driver's
 * account of where the crate is.
 *
 * `all` means the role writes the table unrestricted. A table absent from this
 * map is governed by the action grants alone.
 */
const WRITABLE_FIELDS: Partial<Record<TableName, Record<Role, string[] | 'all'>>> = {
  packlistLines: {
    admin: 'all',
    crew: 'all',
    driver: ['qtyReceived', 'note'],
    // What arrived, what is left at the end of the day or went back in the
    // van, and who counted it. Never what was required or what was sent.
    volunteer: ['qtyReceived', 'qtyLeft', 'countedBy', 'qtyReturned', 'note'],
  },
  packlists: {
    admin: 'all',
    crew: 'all',
    driver: ['status', 'notes'],
    volunteer: ['notes'],
  },
};

/** Which fields this session may write on a table, or 'all'. */
export function writableFields(session: Session | null, table: TableName): string[] | 'all' {
  if (!session || isExpired(session)) return session ? [] : 'all';
  if (customised(session)) return accessFields(session.access, table);
  return WRITABLE_FIELDS[table]?.[session.role] ?? 'all';
}

/**
 * Fields the boxes allow on a packlist. Packing is the whole row; recording a
 * delivery or confirming one is the same handful of fields the volunteer and
 * the driver have always had, and both together get both. Mirrors
 * access_fields in supabase/schema.sql.
 */
function accessFields(access: Access[], table: TableName): string[] | 'all' {
  const rules = WRITABLE_FIELDS[table];
  if (!rules || access.includes('pack')) return 'all';
  const fields = new Set<string>();
  if (access.includes('receive')) for (const field of rules.volunteer as string[]) fields.add(field);
  if (access.includes('deliver')) for (const field of rules.driver as string[]) fields.add(field);
  return [...fields];
}

export function canEditField(session: Session | null, table: TableName, field: string): boolean {
  const allowed = writableFields(session, table);
  return allowed === 'all' || allowed.includes(field);
}

/**
 * Drop everything a session may not write, so a stray change never reaches the
 * local database. The screens hide these controls; this is the floor under
 * them, and it is the reason a volunteer's copy of a packlist cannot drift
 * from the warehouse's.
 */
export function scrubChanges<T extends object>(
  session: Session | null,
  table: TableName,
  changes: T,
): Partial<T> {
  const allowed = writableFields(session, table);
  if (allowed === 'all') return changes;
  const kept: Partial<T> = {};
  for (const key of Object.keys(changes) as Array<keyof T & string>) {
    if (allowed.includes(key)) kept[key] = changes[key];
  }
  return kept;
}

/**
 * Tables that belong to one event: the row carries the event, directly or
 * through its packlist or load. Everything else — the catalogue, the ledger,
 * stocktakes, templates — is the warehouse's, shared by every event.
 *
 * A shopping line may carry an event or none. Crew given one event write the
 * lines for that event, since buying for it is part of planning its food;
 * a line with no event is a warehouse restock, which the scope check on the
 * server refuses them, the same as any other warehouse-wide row.
 */
export const EVENT_TABLES: TableName[] = [
  'events', 'destinations', 'races', 'consumptionLines',
  'packlists', 'packlistLines', 'containers',
  'loads', 'loadStops', 'shoppingLines',
];

/**
 * Everything crew given the whole warehouse may write: every synced table bar
 * the admin-only ones. Listed rather than 'all' so a note can never ride out
 * in a crew member's outbox.
 */
export const CREW_TABLES: TableName[] = SYNCED_TABLES.filter((table) => !ADMIN_TABLES.includes(table));

/**
 * Narrow a change set down to what a session is actually allowed to write.
 * Used by the mock backend, and by the client to avoid pushing doomed rows.
 *
 * Crew given one event write that event's tables and nothing warehouse-wide;
 * the server refuses those rows anyway, and a row refused after it was written
 * locally is a number this phone believes and nobody else does.
 */
export function writableTables(session: Session | null): TableName[] | 'all' {
  if (!session) return 'all';
  if (customised(session)) {
    const tables = new Set(session.access.flatMap((key) => ACCESS_WRITES[key]));
    // Pinned to one event, nothing warehouse-wide survives the server's scope check.
    return SYNCED_TABLES.filter(
      (table) => tables.has(table) && (!isEventScoped(session) || EVENT_TABLES.includes(table)),
    );
  }
  switch (session.role) {
    case 'admin':
      return 'all';
    case 'crew':
      return isEventScoped(session) ? EVENT_TABLES : CREW_TABLES;
    case 'driver':
      return ['loadStops', 'loads', 'packlists', 'packlistLines'];
    case 'volunteer':
      return ['packlists', 'packlistLines'];
  }
}

/**
 * Plain-language summary for the access screen.
 *
 * Takes a scope as well as a role, because the same role reads very
 * differently pinned to one event: crew for the Hounslow Classic do not run
 * stocktakes, and the card should not say they do.
 */
export function describeRole(
  role: Role,
  scope: Scope = UNSCOPED,
  access: Access[] | null = null,
): string[] {
  const who: Session = {
    userId: '', displayName: '', email: null, role, scope, token: '', expiresAt: null, guest: false, access,
  };
  const has = (action: Action) => can(who, action);
  const lines: string[] = [];
  if (has('item:write')) lines.push('Add and edit stock items');
  else if (has('item:read')) lines.push('View the stock catalogue');
  if (has('stock:adjust')) lines.push('Adjust stock quantities');
  if (has('packlist:manage')) lines.push('Build and change packing lists');
  else if (has('packlist:receive')) lines.push('Record what arrived on their packing list');
  if (has('load:manage')) lines.push('Plan transport loads');
  else if (has('load:deliver')) lines.push('Confirm deliveries');
  if (has('event:write')) lines.push('Edit the event and its stations');
  if (has('stocktake:manage')) lines.push('Run stocktakes');
  if (has('template:manage')) lines.push('Edit templates');
  if (has('food:plan')) lines.push('Plan the food');
  if (has('shopping:manage')) lines.push('Keep the shopping list');
  if (has('member:manage')) lines.push('Invite people and set their access');
  return lines;
}
