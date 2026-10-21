import { useState } from 'react';
import { useDestinations, useEvents } from './useDb';
import { draftFrom } from '../domain/accessDraft';
import type { AccessDraft } from '../domain/accessDraft';
import { ROLE_LABELS } from '../sync/types';
import type { AccessGrant } from '../sync/types';

export function useAccessDraft(initial: AccessGrant | null) {
  return useState<AccessDraft>(() => draftFrom(initial));
}

/** The name an invite gets when none is typed: its station, or its role and event. */
export function useAutoLabel(draft: AccessDraft): string {
  const events = useEvents();
  const destinations = useDestinations(draft.eventId || undefined);
  const event = events?.find((entry) => entry.id === draft.eventId);
  const destination = destinations?.find((entry) => entry.id === draft.destinationId);
  if (destination) {
    return `${destination.name}${draft.role === 'volunteer' ? '' : ` · ${ROLE_LABELS[draft.role]}`}`;
  }
  return `${ROLE_LABELS[draft.role]} · ${event ? event.name : 'all events'}`;
}
