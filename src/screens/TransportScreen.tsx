import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState, Field, Pill, ProgressBar, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { useEvents, useSettings } from '../hooks/useDb';
import { LOAD_STATUS_LABELS, createLoad, loadProgress } from '../domain/transport';
import { formatDateTime, plural } from '../domain/format';
import type { LoadStatus } from '../db/types';

const TONE: Record<LoadStatus, 'default' | 'ok' | 'warn' | 'info' | 'accent'> = {
  planned: 'default',
  loading: 'accent',
  in_transit: 'info',
  delivering: 'info',
  complete: 'ok',
  cancelled: 'warn',
};

/** Every vehicle run, newest first, optionally narrowed to one event. */
export default function TransportScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const events = useEvents();
  const eventFilter = params.get('event') ?? '';
  const [creating, setCreating] = useState(false);

  const loads = useLiveQuery(
    async () =>
      alive(await db.loads.toArray())
        .filter((load) => !eventFilter || load.eventId === eventFilter)
        .sort((a, b) => (b.departAt ?? b.createdAt).localeCompare(a.departAt ?? a.createdAt)),
    [eventFilter],
  );

  const stops = useLiveQuery(async () => alive(await db.loadStops.toArray()), [loads]);

  return (
    <Screen
      title="Transport"
      actions={
        <button type="button" className="header-btn" aria-label="New load" onClick={() => setCreating(true)}>
          +
        </button>
      }
    >
      <div className="chip-row mb-3">
        <button
          type="button"
          className="chip"
          aria-pressed={!eventFilter}
          onClick={() => setParams({}, { replace: true })}
        >
          All events
        </button>
        {(events ?? []).map((event) => (
          <button
            key={event.id}
            type="button"
            className="chip"
            aria-pressed={eventFilter === event.id}
            onClick={() => setParams(eventFilter === event.id ? {} : { event: event.id }, { replace: true })}
          >
            {event.name}
          </button>
        ))}
      </div>

      {loads && !loads.length ? (
        <EmptyState
          glyph="🚚"
          title="No loads yet"
          body="A load is one vehicle doing one trip — a driver, a run sheet and the crates on board."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Plan a load
            </button>
          }
        />
      ) : null}

      <div className="list">
        {(loads ?? []).map((load) => {
          const progress = loadProgress((stops ?? []).filter((stop) => stop.loadId === load.id));
          const event = events?.find((entry) => entry.id === load.eventId);
          return (
            <Link key={load.id} to={`/transport/${load.id}`} className="row">
              <span className="row-icon">🚚</span>
              <span className="row-body">
                <span className="row-title">{load.name}</span>
                <span className="row-sub">
                  {event?.name ?? 'No event'} · {load.vehicle || 'no vehicle'} ·{' '}
                  {load.driver || 'no driver'}
                </span>
                <span className="row-sub tiny">
                  {plural(progress.stops, 'stop')} · {progress.delivered} delivered
                  {load.departAt ? ` · leaves ${formatDateTime(load.departAt)}` : ''}
                </span>
                {progress.stops ? (
                  <span style={{ display: 'block', marginTop: 6 }}>
                    <ProgressBar percent={progress.percent} done={progress.percent === 100} />
                  </span>
                ) : null}
              </span>
              <Pill tone={TONE[load.status]}>{LOAD_STATUS_LABELS[load.status]}</Pill>
            </Link>
          );
        })}
      </div>

      {creating ? (
        <NewLoadSheet
          defaultEventId={eventFilter || events?.[0]?.id || ''}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/transport/${id}`)}
        />
      ) : null}
    </Screen>
  );
}

function NewLoadSheet({
  defaultEventId,
  onClose,
  onCreated,
}: {
  defaultEventId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const events = useEvents();
  const settings = useSettings();
  const toast = useToast();
  const [eventId, setEventId] = useState(defaultEventId);
  const [name, setName] = useState('Run 1');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [phone, setPhone] = useState('');
  const [departAt, setDepartAt] = useState('');

  const save = async () => {
    if (!eventId) return;
    const load = await createLoad(eventId, {
      name,
      vehicle,
      driver,
      phone,
      departAt: departAt || null,
    });
    toast('Load created — now add stops');
    onCreated(load.id);
  };

  return (
    <Sheet
      title="Plan a load"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!eventId} onClick={() => void save()}>
            Create
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Event">
          {(id) => (
            <select id={id} className="select" value={eventId} onChange={(event) => setEventId(event.target.value)}>
              <option value="">Choose an event</option>
              {(events ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Run name">
          {(id) => (
            <input
              id={id}
              className="input"
              value={name}
              placeholder="Run 1 — village + low stations"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        {/*
          Saved vehicles are offered as tap targets rather than a <datalist>.
          Safari on iOS ignores datalist entirely, so half the crew would get no
          suggestions at all, and where it does work the popup fights with the
          scrolling sheet. Tapping a chip is also just faster than typing.
        */}
        <Field label="Vehicle">
          {(id) => (
            <>
              <input
                id={id}
                className="input"
                value={vehicle}
                placeholder="6m Truck"
                onChange={(event) => setVehicle(event.target.value)}
              />
              {settings?.vehicles.length ? (
                <div className="chip-row chip-row-inline">
                  {settings.vehicles.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="chip"
                      aria-pressed={vehicle === option}
                      onClick={() => setVehicle(vehicle === option ? '' : option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Field>
        <div className="field-row">
          <Field label="Driver">
            {(id) => (
              <input id={id} className="input" value={driver} onChange={(event) => setDriver(event.target.value)} />
            )}
          </Field>
          <Field label="Phone">
            {(id) => (
              <input
                id={id}
                className="input"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Departs" hint="When the vehicle is due to leave the warehouse.">
          {(id) => (
            <input
              id={id}
              type="datetime-local"
              className="input"
              value={departAt}
              onChange={(event) => setDepartAt(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
