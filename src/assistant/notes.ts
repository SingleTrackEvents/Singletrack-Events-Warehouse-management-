import { db } from '../db/db';
import { alive, create } from '../db/repo';
import { DESTINATION_LABELS } from '../domain/format';
import type { AssistantNote, DestinationType } from '../db/types';
import type { NoteScope } from './protocol';

/**
 * The assistant's memory.
 *
 * Notes are short sentences, each pinned to an event, a kind of destination,
 * or neither. A check sends the assistant only the notes that apply to the
 * list in front of it, so a rule about the Hounslow Classic never colours a
 * Buffalo Stampede list, and a rule about walk-in stations stays out of the
 * event village.
 */

/** Where a list sits, for deciding which notes apply to it. */
export interface NoteTarget {
  eventId: string;
  destinationType: DestinationType;
}

/** True when the note applies to this list. */
export function noteApplies(note: AssistantNote, target: NoteTarget): boolean {
  if (note.deletedAt) return false;
  if (note.eventId && note.eventId !== target.eventId) return false;
  if (note.destinationType && note.destinationType !== target.destinationType) return false;
  return true;
}

/** The notes to send with a check, most general first. */
export function notesFor(notes: AssistantNote[], target: NoteTarget): AssistantNote[] {
  return notes
    .filter((note) => noteApplies(note, target))
    .sort((a, b) => specificity(a) - specificity(b) || a.createdAt.localeCompare(b.createdAt));
}

/** How narrowly a note is scoped: general rules first, then by type, then by event. */
function specificity(note: AssistantNote): number {
  return (note.destinationType ? 1 : 0) + (note.eventId ? 2 : 0);
}

/** All live notes, oldest first. */
export async function allNotes(): Promise<AssistantNote[]> {
  return alive(await db.assistantNotes.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Save a note. Blank text saves nothing and returns undefined. */
export async function addNote(input: {
  text: string;
  eventId?: string | null;
  destinationType?: DestinationType | null;
  source?: AssistantNote['source'];
}): Promise<AssistantNote | undefined> {
  const body = input.text.trim();
  if (!body) return undefined;
  return create(db.assistantNotes, {
    text: body,
    eventId: input.eventId ?? null,
    destinationType: input.destinationType ?? null,
    source: input.source ?? 'written',
  });
}

/**
 * Turn a scope the assistant proposed into the columns a note carries.
 * "This event" and "this kind of station" are read off the list being checked.
 */
export function scopeFor(scope: NoteScope, target: NoteTarget): Pick<AssistantNote, 'eventId' | 'destinationType'> {
  switch (scope) {
    case 'event':
      return { eventId: target.eventId, destinationType: null };
    case 'destinationType':
      return { eventId: null, destinationType: target.destinationType };
    default:
      return { eventId: null, destinationType: null };
  }
}

/**
 * The note that stops a suggestion coming back.
 *
 * Dismissing a suggestion once is a judgement about this list; asking not to
 * hear it again is a rule about this kind of station, and is worded so it
 * still makes sense when read on its own in the notes list a season later.
 */
export function dismissalNote(itemName: string, destinationType: DestinationType): string {
  return `Do not suggest ${itemName} for ${DESTINATION_LABELS[destinationType].toLowerCase()} lists unless the list itself asks for it.`;
}

/** A one-line label for where a note applies, for the notes screen. */
export function describeScope(
  note: Pick<AssistantNote, 'eventId' | 'destinationType'>,
  eventName?: string,
): string {
  const parts: string[] = [];
  if (note.eventId) parts.push(eventName ?? 'One event');
  if (note.destinationType) parts.push(`${DESTINATION_LABELS[note.destinationType]} lists`);
  return parts.length ? parts.join(' · ') : 'Everywhere';
}
