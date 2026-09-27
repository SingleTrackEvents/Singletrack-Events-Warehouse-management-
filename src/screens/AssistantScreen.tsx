import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { ConfirmSheet, EmptyState, Field, Pill, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, softDelete } from '../db/repo';
import { useEvents } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import { AssistantError, pingAssistant } from '../assistant/client';
import { addNote, describeScope } from '../assistant/notes';
import { DESTINATION_LABELS, plural } from '../domain/format';
import type { AssistantNote, DestinationType } from '../db/types';
import { DESTINATION_TYPES } from '../db/types';

/**
 * The packing assistant: what it knows, and whether it is switched on.
 *
 * Admin only. Notes written here are sent with every check they apply to, so
 * this is where the assistant is taught how SingleTrack packs: which stations
 * have no power, what never goes to a walk-in site, which event runs the big
 * marquee. It is deliberately a list of short sentences rather than one long
 * brief, so a rule can be pinned to one event or one kind of station and
 * removed on its own when it stops being true.
 */
export default function AssistantScreen() {
  const toast = useToast();
  const { backend, session } = useSession();
  const events = useEvents();
  const notes = useLiveQuery(
    async () => alive(await db.assistantNotes.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [],
  );
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AssistantNote>();
  const [test, setTest] = useState<{ phase: 'idle' | 'running' | 'ok' | 'failed'; message: string }>({
    phase: 'idle',
    message: '',
  });

  if (!can(session, 'assistant:use')) return <Navigate to="/" replace />;

  const eventName = (id: string | null) => (id ? events?.find((event) => event.id === id)?.name : undefined);

  const runTest = async () => {
    setTest({ phase: 'running', message: '' });
    try {
      if (!session) throw new AssistantError('Sign in as an admin first. The assistant needs an account to bill against.', 'auth');
      const token = (await backend?.accessToken?.()) ?? session.token;
      const result = await pingAssistant(token);
      setTest({ phase: 'ok', message: `Connected. Checks run on ${result.model}.` });
    } catch (cause) {
      setTest({
        phase: 'failed',
        message: cause instanceof Error ? cause.message : 'The assistant did not answer.',
      });
    }
  };

  return (
    <Screen
      title="Packing assistant"
      back="/more"
      actions={
        <button type="button" className="header-btn" aria-label="New note" onClick={() => setAdding(true)}>
          +
        </button>
      }
    >
      <p className="small muted mb-3">
        On any packlist, <span className="strong">Check this list</span> asks the assistant what is
        missing, which quantities look wrong and what it would ask, reading the catalogue, the templates,
        the food plan and earlier editions of the same station. Nothing changes on a list until you tap.
      </p>

      <section className="section">
        <div className="section-head">
          <h2>What it knows</h2>
        </div>
        <p className="small muted mb-3">
          Short rules, each pinned to an event, a kind of destination, or neither. The assistant reads the
          ones that apply before every check, and they outrank templates and history.
        </p>
        {notes && !notes.length ? (
          <EmptyState
            glyph="✨"
            title="Nothing written down yet"
            body="Start with the things a new crew member always gets wrong. “Grand Canyon Carpark has no power, always a generator.”"
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                Write the first note
              </button>
            }
          />
        ) : null}
        <div className="list">
          {(notes ?? []).map((note) => (
            <SwipeToDelete key={note.id} label="Delete" onDelete={() => setRemoving(note)}>
              <div className="row row-static assistant-note">
                <span className="row-icon">{note.source === 'learned' ? '💡' : '📝'}</span>
                <span className="row-body">
                  <span className="row-title" style={{ fontWeight: 500 }}>
                    {note.text}
                  </span>
                  <span className="row-sub">
                    {describeScope(note, eventName(note.eventId))}
                    {note.source === 'learned' ? ' · learned from a check' : ''}
                  </span>
                </span>
              </div>
            </SwipeToDelete>
          ))}
        </div>
        {notes?.length ? (
          <p className="tiny muted mt-2">{plural(notes.length, 'note')}. Swipe left to delete one.</p>
        ) : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Connection</h2>
        </div>
        <div className="card card-pad">
          <p className="small muted mb-3">
            Checks run through a function in the Supabase project, which holds the Claude API key. The
            phone never sees the key. Setting it up is covered in the README.
          </p>
          <div className="row-flex wrap">
            <button
              type="button"
              className="btn btn-outline"
              disabled={test.phase === 'running'}
              onClick={() => void runTest()}
            >
              {test.phase === 'running' ? 'Testing…' : 'Test the connection'}
            </button>
            {test.phase === 'ok' ? <Pill tone="ok">Working</Pill> : null}
            {test.phase === 'failed' ? <Pill tone="danger">Not yet</Pill> : null}
          </div>
          {test.message ? <p className="small mt-3">{test.message}</p> : null}
          {!session ? (
            <p className="tiny muted mt-2">
              This phone is not signed in. Notes can still be written here and will sync once it is.
            </p>
          ) : null}
        </div>
      </section>

      {adding ? (
        <NewNoteSheet
          events={(events ?? []).map((event) => ({ id: event.id, name: event.name }))}
          onClose={() => setAdding(false)}
          onSave={(input) => {
            void addNote(input).then((saved) => {
              toast(saved ? 'Note saved' : 'Write something first', saved ? 'ok' : 'warn');
              if (saved) setAdding(false);
            });
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmSheet
          title="Delete this note?"
          body={removing.text}
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            void softDelete(db.assistantNotes, removing.id);
            setRemoving(undefined);
            toast('Note deleted');
          }}
        />
      ) : null}
    </Screen>
  );
}

type NoteWhere = 'everywhere' | 'event' | 'type';

function NewNoteSheet({
  events,
  onClose,
  onSave,
}: {
  events: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (input: { text: string; eventId: string | null; destinationType: DestinationType | null }) => void;
}) {
  const [text, setText] = useState('');
  const [where, setWhere] = useState<NoteWhere>('everywhere');
  const [eventId, setEventId] = useState(events[0]?.id ?? '');
  const [destinationType, setDestinationType] = useState<DestinationType>('aid_station');

  const save = () =>
    onSave({
      text,
      eventId: where === 'event' ? eventId || null : null,
      destinationType: where === 'type' ? destinationType : null,
    });

  return (
    <Sheet
      title="New note"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="The rule" hint="One sentence, the way you would say it to a new crew member.">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              autoFocus
              value={text}
              placeholder="Never send glass to a walk-in station."
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <Field label="Applies to">
          {(id) => (
            <select id={id} className="select" value={where} onChange={(event) => setWhere(event.target.value as NoteWhere)}>
              <option value="everywhere">Every list</option>
              <option value="type">One kind of destination</option>
              {events.length ? <option value="event">One event</option> : null}
            </select>
          )}
        </Field>
        {where === 'event' ? (
          <Field label="Event">
            {(id) => (
              <select id={id} className="select" value={eventId} onChange={(event) => setEventId(event.target.value)}>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        {where === 'type' ? (
          <Field label="Kind of destination">
            {(id) => (
              <select
                id={id}
                className="select"
                value={destinationType}
                onChange={(event) => setDestinationType(event.target.value as DestinationType)}
              >
                {DESTINATION_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {DESTINATION_LABELS[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}
