import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Field, Pill, Sheet } from '../components/ui';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { create } from '../db/repo';
import { useEvents } from '../hooks/useDb';
import { EVENT_STATUS_LABELS, daysUntil, formatDateRange, plural, relativeDays } from '../domain/format';
import { describeEventRemoval, removeEvent } from '../domain/remove';
import type { RemovalSummary } from '../domain/remove';
import type { RaceEvent } from '../db/types';
import type { EventStatus } from '../db/types';
import { EVENT_STATUSES } from '../db/types';

const STATUS_TONE: Record<EventStatus, 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'> = {
  planning: 'info',
  packing: 'accent',
  live: 'ok',
  debrief: 'warn',
  closed: 'default',
};

export default function EventsScreen() {
  const events = useEvents();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ event: RaceEvent; summary: RemovalSummary }>();

  // The summary is read before anything changes, so the confirmation can name
  // exactly what is about to go with it.
  const askToRemove = (event: RaceEvent) => {
    void describeEventRemoval(event.id).then((summary) => setRemoving({ event, summary }));
  };

  const upcoming = events?.filter((event) => daysUntil(event.endDate) >= 0 && event.status !== 'closed') ?? [];
  const past = events?.filter((event) => daysUntil(event.endDate) < 0 || event.status === 'closed') ?? [];

  return (
    <Screen
      title="Events"
      actions={
        <button type="button" className="header-btn" aria-label="Add event" onClick={() => setAdding(true)}>
          +
        </button>
      }
    >
      {events && !events.length ? (
        <EmptyState
          glyph="🏃"
          title="No events yet"
          body="An event holds the aid stations, packlists and transport runs for one race."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Add your first event
            </button>
          }
        />
      ) : null}

      {upcoming.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Coming up</h2>
          </div>
          <div className="list">
            {upcoming.map((event) => (
              <SwipeToDelete key={event.id} onDelete={() => askToRemove(event)}>
                <Link to={`/events/${event.id}`} className="row">
                  <span className="row-body">
                    <span className="row-title">{event.name}</span>
                    <span className="row-sub">
                      {event.location} · {formatDateRange(event.startDate, event.endDate)}
                    </span>
                  </span>
                  <span className="row-end stack-sm" style={{ alignItems: 'flex-end' }}>
                    <Pill tone={STATUS_TONE[event.status]}>{EVENT_STATUS_LABELS[event.status]}</Pill>
                    <span className="tiny muted">{relativeDays(event.startDate)}</span>
                  </span>
                </Link>
              </SwipeToDelete>
            ))}
          </div>
        </section>
      ) : null}

      {past.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Done</h2>
          </div>
          <div className="list">
            {past.map((event) => (
              <SwipeToDelete key={event.id} onDelete={() => askToRemove(event)}>
                <Link to={`/events/${event.id}`} className="row">
                  <span className="row-body">
                    <span className="row-title">{event.name}</span>
                    <span className="row-sub">
                      {event.location} · {formatDateRange(event.startDate, event.endDate)}
                    </span>
                  </span>
                  <Pill tone={STATUS_TONE[event.status]}>{EVENT_STATUS_LABELS[event.status]}</Pill>
                </Link>
              </SwipeToDelete>
            ))}
          </div>
        </section>
      ) : null}

      {events?.length ? (
        <p className="tiny muted center mt-3">Swipe an event left to delete it.</p>
      ) : null}

      {adding ? <EventSheet onClose={() => setAdding(false)} /> : null}

      {removing ? (
        <ConfirmSheet
          title={`Delete ${removing.event.name}?`}
          body={
            <>
              This also removes {plural(removing.summary.destinations, 'destination')},{' '}
              {plural(removing.summary.packlists, 'packlist')} and{' '}
              {plural(removing.summary.loads, 'transport run')}.
              <div className="mt-2">
                Stock movements are kept — the ledger is the record of what actually left the
                warehouse, and deleting a race should not rewrite that.
              </div>
            </>
          }
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            const target = removing.event;
            setRemoving(undefined);
            void removeEvent(target.id).then(() => toast(`${target.name} deleted`));
          }}
        />
      ) : null}
    </Screen>
  );
}

/** Create-event form. Kept to the fields you actually know when a race is booked. */
function EventSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [status, setStatus] = useState<EventStatus>('planning');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await create(db.events, {
      name: name.trim(),
      location: location.trim(),
      startDate,
      // A blank or earlier end date just mirrors the start.
      endDate: endDate && endDate >= startDate ? endDate : startDate,
      status,
      notes: notes.trim(),
    });
    toast('Event added');
    onClose();
  };

  return (
    <Sheet
      title="New event"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
          >
            Add event
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Event name">
          {(id) => (
            <input
              id={id}
              className="input"
              value={name}
              autoFocus
              placeholder="Buffalo Stampede"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Location">
          {(id) => (
            <input
              id={id}
              className="input"
              value={location}
              placeholder="Bright, VIC"
              onChange={(event) => setLocation(event.target.value)}
            />
          )}
        </Field>
        <div className="field-row">
          <Field label="Starts">
            {(id) => (
              <input
                id={id}
                type="date"
                className="input"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            )}
          </Field>
          <Field label="Ends">
            {(id) => (
              <input
                id={id}
                type="date"
                className="input"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Status">
          {(id) => (
            <select
              id={id}
              className="select"
              value={status}
              onChange={(event) => setStatus(event.target.value as EventStatus)}
            >
              {EVENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {EVENT_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Notes" hint="Anything the packing crew should know.">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
