import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { addNote, describeScope, dismissalNote, noteApplies, notesFor, scopeFor } from './notes';
import type { AssistantNote } from '../db/types';

const note = (overrides: Partial<AssistantNote>): AssistantNote => ({
  id: overrides.id ?? Math.random().toString(36).slice(2),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  rev: 1,
  deviceId: 'test',
  syncedAt: null,
  text: 'A rule',
  eventId: null,
  destinationType: null,
  source: 'written',
  ...overrides,
});

const HERE = { eventId: 'hounslow', destinationType: 'aid_station' as const };

describe('which notes a check is sent', () => {
  it('sends a general note everywhere', () => {
    expect(noteApplies(note({}), HERE)).toBe(true);
  });

  it('keeps one event’s rules out of another event’s lists', () => {
    expect(noteApplies(note({ eventId: 'hounslow' }), HERE)).toBe(true);
    expect(noteApplies(note({ eventId: 'buffalo' }), HERE)).toBe(false);
  });

  it('keeps a rule about walk-in stations out of the event village', () => {
    expect(noteApplies(note({ destinationType: 'aid_station' }), HERE)).toBe(true);
    expect(noteApplies(note({ destinationType: 'event_village' }), HERE)).toBe(false);
  });

  it('never sends a deleted note', () => {
    expect(noteApplies(note({ deletedAt: '2026-02-01T00:00:00.000Z' }), HERE)).toBe(false);
  });

  it('orders general rules first, then by kind of station, then by event', () => {
    const ordered = notesFor(
      [
        note({ id: 'event', eventId: 'hounslow', text: 'event' }),
        note({ id: 'type', destinationType: 'aid_station', text: 'type' }),
        note({ id: 'all', text: 'all' }),
        note({ id: 'other', eventId: 'buffalo', text: 'other' }),
      ],
      HERE,
    );
    expect(ordered.map((entry) => entry.text)).toEqual(['all', 'type', 'event']);
  });
});

describe('writing notes', () => {
  it('saves a trimmed note and refuses a blank one', async () => {
    expect(await addNote({ text: '   ' })).toBeUndefined();
    const saved = await addNote({ text: '  Never send glass to a walk-in station.  ', destinationType: 'aid_station' });
    expect(saved?.text).toBe('Never send glass to a walk-in station.');
    expect(saved?.source).toBe('written');
    expect(alive(await db.assistantNotes.toArray())).toHaveLength(1);
  });

  it('turns a proposed scope into the columns a note carries', () => {
    expect(scopeFor('everywhere', HERE)).toEqual({ eventId: null, destinationType: null });
    expect(scopeFor('event', HERE)).toEqual({ eventId: 'hounslow', destinationType: null });
    expect(scopeFor('destinationType', HERE)).toEqual({ eventId: null, destinationType: 'aid_station' });
  });

  it('words a dismissal so it reads on its own a season later', () => {
    expect(dismissalNote('Glass jugs', 'water_drop')).toBe(
      'Do not suggest Glass jugs for water drop lists unless the list itself asks for it.',
    );
  });

  it('describes where a note applies', () => {
    expect(describeScope({ eventId: null, destinationType: null })).toBe('Everywhere');
    expect(describeScope({ eventId: 'x', destinationType: null }, 'Hounslow Classic 2026')).toBe('Hounslow Classic 2026');
    expect(describeScope({ eventId: 'x', destinationType: 'finish' }, 'Hounslow Classic 2026')).toBe(
      'Hounslow Classic 2026 · Finish line lists',
    );
  });
});
