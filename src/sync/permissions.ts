import type { TableName } from '../db/db';
import type { Role, Scope, Session } from './types';

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
  | 'data:wipe';

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
    'event:read', 'event:write', 'event:delete',
    'packlist:read', 'packlist:pack', 'packlist:receive', 'packlist:manage',
    'load:read', 'load:manage', 'load:deliver',
    'stocktake:read', 'stocktake:manage', 'template:manage',
    'member:manage', 'data:export', 'data:wipe',
  ],
  crew: [
    'item:read', 'item:write', 'stock:adjust',
    'event:read', 'event:write',
    'packlist:read', 'packlist:pack', 'packlist:receive', 'packlist:manage',
    'load:read', 'load:manage', 'load:deliver',
    'stocktake:read', 'stocktake:manage', 'template:manage',
    'data:export',
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
 */
export function can(session: Session | null, action: Action, target?: Target): boolean {
  if (!session) return true;
  if (isExpired(session)) return false;
  if (!GRANTS[session.role].includes(action)) return false;
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

/** Position in the authority order; lower is more powerful. */
export function roleRank(role: Role): number {
  return ['admin', 'crew', 'driver', 'volunteer'].indexOf(role);
}

/** True when `role` is at least as powerful as `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return roleRank(role) <= roleRank(minimum);
}

/**
 * Fields a role may change on a packlist line.
 *
 * A volunteer at an aid station records what physically turned up; they must not
 * be able to rewrite what was supposed to be sent, because that would quietly
 * erase the evidence of a short delivery.
 */
const PACKLIST_LINE_FIELDS: Record<Role, string[] | 'all'> = {
  admin: 'all',
  crew: 'all',
  driver: ['note'],
  volunteer: ['qtyReturned', 'note'],
};

export function canEditField(session: Session | null, table: TableName, field: string): boolean {
  if (!session) return true;
  if (isExpired(session)) return false;
  if (table !== 'packlistLines') {
    // Other tables are governed by the action grants alone.
    return true;
  }
  const allowed = PACKLIST_LINE_FIELDS[session.role];
  return allowed === 'all' || allowed.includes(field);
}

/**
 * Narrow a change set down to what a session is actually allowed to write.
 * Used by the mock backend, and by the client to avoid pushing doomed rows.
 */
export function writableTables(session: Session | null): TableName[] | 'all' {
  if (!session) return 'all';
  switch (session.role) {
    case 'admin':
    case 'crew':
      return 'all';
    case 'driver':
      return ['loadStops', 'loads', 'packlists', 'packlistLines'];
    case 'volunteer':
      return ['packlists', 'packlistLines'];
  }
}

/** Plain-language summary for the access screen. */
export function describeRole(role: Role): string[] {
  const grants = GRANTS[role];
  const lines: string[] = [];
  if (grants.includes('item:write')) lines.push('Add and edit stock items');
  else if (grants.includes('item:read')) lines.push('View the stock catalogue');
  if (grants.includes('stock:adjust')) lines.push('Adjust stock quantities');
  if (grants.includes('packlist:manage')) lines.push('Build and change packlists');
  else if (grants.includes('packlist:receive')) lines.push('Record what arrived on a packlist');
  if (grants.includes('load:manage')) lines.push('Plan transport loads');
  else if (grants.includes('load:deliver')) lines.push('Confirm deliveries');
  if (grants.includes('stocktake:manage')) lines.push('Run stocktakes');
  if (grants.includes('member:manage')) lines.push('Invite people and set their access');
  return lines;
}
