import { normaliseAccess, presetAccess } from '../sync/permissions';
import type { Access, AccessGrant, Role, Scope } from '../sync/types';

/**
 * The access editor's working copy: what is picked on screen, before it is
 * turned into the grant an invite or a person is saved with.
 */

export interface AccessDraft {
  role: Role;
  eventId: string;
  destinationId: string;
  picked: Access[];
  /** Set once a box is changed by hand; until then the boxes follow the role. */
  touched: boolean;
}

export function draftFrom(grant: AccessGrant | null): AccessDraft {
  if (!grant) {
    return { role: 'volunteer', eventId: '', destinationId: '', picked: presetAccess('volunteer'), touched: false };
  }
  return {
    role: grant.role,
    eventId: grant.scope.eventId ?? '',
    destinationId: grant.scope.destinationId ?? '',
    picked: grant.access ?? presetAccess(grant.role, grant.scope),
    touched: Boolean(grant.access),
  };
}

export function scopeOf(draft: AccessDraft): Scope {
  if (draft.role === 'admin') return { eventId: null, destinationId: null };
  return {
    eventId: draft.eventId || null,
    destinationId: draft.eventId ? draft.destinationId || null : null,
  };
}

/** The draft as something to save, with the boxes stored as null when they are the role's own. */
export function grantOf(draft: AccessDraft): AccessGrant {
  const scope = scopeOf(draft);
  return {
    role: draft.role,
    scope,
    access: draft.role === 'admin' ? null : normaliseAccess(draft.role, scope, draft.picked),
  };
}

/**
 * Whether the draft can be saved. A volunteer needs their station and a
 * driver their event; only crew and admins may have every event.
 */
export function draftReady(draft: AccessDraft): boolean {
  if (draft.role === 'admin' || draft.role === 'crew') return true;
  if (!draft.eventId) return false;
  return draft.role !== 'volunteer' || Boolean(draft.destinationId);
}
