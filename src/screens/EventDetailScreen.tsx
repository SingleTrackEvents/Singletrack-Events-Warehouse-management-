import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Field, Pill, ProgressBar, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, create, nextSort, softDelete, softDeleteChildren, update } from '../db/repo';
import { useDestinations, useEvent } from '../hooks/useDb';
import { applyTemplate, createPacklist, progressFor, PACKLIST_STATUS_LABELS } from '../domain/packlists';
import { downloadJson, exportEvent, slugify } from '../domain/backup';
import {
  ACCESS_LABELS,
  DESTINATION_ICONS,
  DESTINATION_LABELS,
  EVENT_STATUS_LABELS,
  formatDateRange,
  plural,
  relativeDays,
} from '../domain/format';
import type { AccessType, Destination, DestinationType, EventStatus, PacklistStatus } from '../db/types';
import { ACCESS_TYPES, DESTINATION_TYPES, EVENT_STATUSES } from '../db/types';

const STATUS_TONE: Partial<Record<PacklistStatus, 'ok' | 'warn' | 'info' | 'accent' | 'default'>> = {
  draft: 'default',
  picking: 'accent',
  packed: 'ok',
  loaded: 'info',
  delivered: 'info',
  returned: 'warn',
  reconciled: 'ok',
};

/**
 * One race: its destinations, the packlist behind each, and the shortcuts to
 * build them all from templates in one go.
 */
export default function EventDetailScreen() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const event = useEvent(eventId);
  const destinations = useDestinations(eventId);
  const [addingDestination, setAddingDestination] = useState(false);
  const [editing, setEditing] = useState(false);
  const [buildingLists, setBuildingLists] = useState(false);
  const [removing, setRemoving] = useState<Destination>();

  // Packlists and their line progress, keyed by destination for the list below.
  const summaries = useLiveQuery(async () => {
    if (!eventId) return new Map<string, { status: PacklistStatus; percent: number; id: string; blocking: number }>();
    const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
    const allLines = alive(await db.packlistLines.toArray());
    const map = new Map<string, { status: PacklistStatus; percent: number; id: string; blocking: number }>();
    for (const packlist of packlists) {
      const lines = allLines.filter((line) => line.packlistId === packlist.id);
      const progress = progressFor(lines);
      map.set(packlist.destinationId, {
        id: packlist.id,
        status: packlist.status,
        percent: progress.percent,
        blocking: progress.blocking.length,
      });
    }
    return map;
  }, [eventId, destinations]);

  if (!event) {
    return (
      <Screen title="Event" back="/events">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const withoutPacklist = (destinations ?? []).filter((destination) => !summaries?.get(destination.id));

  const handover = async () => {
    const backup = await exportEvent(event.id, `${event.name} handover`);
    downloadJson(backup, `${slugify(event.name)}-handover.json`);
    toast('Handover file saved to downloads');
  };

  return (
    <Screen
      title={event.name}
      subtitle={`${event.location} · ${relativeDays(event.startDate)}`}
      back="/events"
      actions={
        <button type="button" className="header-btn" aria-label="Edit event" onClick={() => setEditing(true)}>
          ✎
        </button>
      }
    >
      <div className="card card-pad mb-4">
        <div className="spread mb-2">
          <span className="small muted">{formatDateRange(event.startDate, event.endDate)}</span>
          <Pill tone={event.status === 'live' ? 'ok' : 'info'}>{EVENT_STATUS_LABELS[event.status]}</Pill>
        </div>
        {event.notes ? <p className="small">{event.notes}</p> : null}
        <div className="btn-row mt-3">
          <Link className="btn btn-outline btn-sm" to={`/transport?event=${event.id}`}>
            🚚 Transport
          </Link>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void handover()}>
            ⬇ Handover file
          </button>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Destinations</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingDestination(true)}>
            + Add
          </button>
        </div>

        {destinations && !destinations.length ? (
          <EmptyState
            glyph="⛺"
            title="No destinations yet"
            body="Add each aid station, the event village and any water drops."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAddingDestination(true)}>
                Add a destination
              </button>
            }
          />
        ) : null}

        <div className="list">
          {(destinations ?? []).map((destination) => {
            const summary = summaries?.get(destination.id);
            return (
              <button
                key={destination.id}
                type="button"
                className="row"
                onClick={() => {
                  if (summary) navigate(`/packlists/${summary.id}`);
                  else void createPacklist(destination).then((packlist) => navigate(`/packlists/${packlist.id}`));
                }}
              >
                <span className="row-icon">{DESTINATION_ICONS[destination.type]}</span>
                <span className="row-body">
                  <span className="row-title">{destination.name}</span>
                  <span className="row-sub">
                    {DESTINATION_LABELS[destination.type]}
                    {destination.courseKm !== null ? ` · ${destination.courseKm} km` : ''} ·{' '}
                    {ACCESS_LABELS[destination.access]}
                  </span>
                  {summary ? (
                    <span style={{ display: 'block', marginTop: 6 }}>
                      <ProgressBar percent={summary.percent} done={summary.percent === 100} />
                    </span>
                  ) : null}
                </span>
                <span className="row-end">
                  {summary ? (
                    <>
                      <Pill tone={STATUS_TONE[summary.status] ?? 'default'}>
                        {PACKLIST_STATUS_LABELS[summary.status]}
                      </Pill>
                      {summary.blocking ? (
                        <div className="tiny" style={{ color: 'var(--danger)', marginTop: 4 }}>
                          {summary.blocking} short
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Pill tone="accent">Build list</Pill>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {withoutPacklist.length ? (
          <button
            type="button"
            className="btn btn-primary btn-block mt-3"
            onClick={() => setBuildingLists(true)}
          >
            Build {plural(withoutPacklist.length, 'packlist')} from templates
          </button>
        ) : null}
      </section>

      {destinations?.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Manage</h2>
          </div>
          <div className="list">
            {destinations.map((destination) => (
              <div key={destination.id} className="row row-static">
                <span className="row-body">
                  <span className="row-title truncate">{destination.name}</span>
                  <span className="row-sub truncate">{destination.accessNotes || 'No access notes'}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRemoving(destination)}
                  aria-label={`Remove ${destination.name}`}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {addingDestination ? (
        <DestinationSheet
          eventId={event.id}
          existing={destinations ?? []}
          onClose={() => setAddingDestination(false)}
        />
      ) : null}

      {editing ? <EditEventSheet eventId={event.id} onClose={() => setEditing(false)} /> : null}

      {buildingLists ? (
        <BuildListsSheet
          destinations={withoutPacklist}
          onClose={() => setBuildingLists(false)}
          onDone={(count) => {
            toast(`${plural(count, 'packlist')} created`);
            setBuildingLists(false);
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmSheet
          title={`Remove ${removing.name}?`}
          body="Its packlist is removed too. Stock already issued stays on the ledger."
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            const target = removing;
            setRemoving(undefined);
            void (async () => {
              const packlists = alive(await db.packlists.where('destinationId').equals(target.id).toArray());
              for (const packlist of packlists) {
                await softDeleteChildren(db.packlistLines, 'packlistId', packlist.id);
                await softDelete(db.packlists, packlist.id);
              }
              await softDelete(db.destinations, target.id);
              toast('Destination removed');
            })();
          }}
        />
      ) : null}
    </Screen>
  );
}

/** Add a destination. Access and timings matter as much as the name out here. */
function DestinationSheet({
  eventId,
  existing,
  onClose,
}: {
  eventId: string;
  existing: Destination[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<DestinationType>('aid_station');
  const [courseKm, setCourseKm] = useState('');
  const [access, setAccess] = useState<AccessType>('2wd');
  const [accessNotes, setAccessNotes] = useState('');
  const [crewLead, setCrewLead] = useState('');
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('16:00');

  const save = async () => {
    if (!name.trim()) return;
    await create(db.destinations, {
      eventId,
      name: name.trim(),
      type,
      courseKm: courseKm.trim() ? Number(courseKm) : null,
      access,
      accessNotes: accessNotes.trim(),
      lat: null,
      lng: null,
      crewLead: crewLead.trim(),
      phone: '',
      openTime,
      closeTime,
      notes: '',
      sort: nextSort(existing),
    });
    toast('Destination added');
    onClose();
  };

  return (
    <Sheet
      title="New destination"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            Add
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              value={name}
              placeholder="Aid 3 — Buffalo Plateau"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="field-row">
          <Field label="Type">
            {(id) => (
              <select
                id={id}
                className="select"
                value={type}
                onChange={(event) => setType(event.target.value as DestinationType)}
              >
                {DESTINATION_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {DESTINATION_LABELS[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Course km">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="decimal"
                value={courseKm}
                placeholder="42"
                onChange={(event) => setCourseKm(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Vehicle access">
          {(id) => (
            <select
              id={id}
              className="select"
              value={access}
              onChange={(event) => setAccess(event.target.value as AccessType)}
            >
              {ACCESS_TYPES.map((option) => (
                <option key={option} value={option}>
                  {ACCESS_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Access notes" hint="Gate codes, turning circles, how long it takes.">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={accessNotes}
              onChange={(event) => setAccessNotes(event.target.value)}
            />
          )}
        </Field>
        <Field label="Crew lead">
          {(id) => (
            <input
              id={id}
              className="input"
              value={crewLead}
              onChange={(event) => setCrewLead(event.target.value)}
            />
          )}
        </Field>
        <div className="field-row">
          <Field label="Opens">
            {(id) => (
              <input
                id={id}
                type="time"
                className="input"
                value={openTime}
                onChange={(event) => setOpenTime(event.target.value)}
              />
            )}
          </Field>
          <Field label="Closes">
            {(id) => (
              <input
                id={id}
                type="time"
                className="input"
                value={closeTime}
                onChange={(event) => setCloseTime(event.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

function EditEventSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const event = useEvent(eventId);
  const toast = useToast();
  const [status, setStatus] = useState<EventStatus | ''>('');
  const [notes, setNotes] = useState<string | null>(null);

  if (!event) return null;
  const currentStatus = status || event.status;
  const currentNotes = notes ?? event.notes;

  return (
    <Sheet
      title="Edit event"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void update(db.events, event.id, { status: currentStatus, notes: currentNotes }).then(() => {
                toast('Event updated');
                onClose();
              });
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Status">
          {(id) => (
            <select
              id={id}
              className="select"
              value={currentStatus}
              onChange={(changed) => setStatus(changed.target.value as EventStatus)}
            >
              {EVENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {EVENT_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={currentNotes}
              onChange={(changed) => setNotes(changed.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}

/**
 * Bulk-create packlists. Each destination is matched to a template of its own
 * type by default; the crew can override the pick per destination before
 * committing, which is the difference between a useful shortcut and a mess.
 */
function BuildListsSheet({
  destinations,
  onClose,
  onDone,
}: {
  destinations: Destination[];
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const templates = useLiveQuery(async () => alive(await db.templates.toArray()), []);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);

  const templateFor = (destination: Destination) => {
    if (choices[destination.id] !== undefined) return choices[destination.id];
    const match = templates?.find((template) => template.appliesTo === destination.type);
    return match?.id ?? '';
  };

  const build = async () => {
    setWorking(true);
    let count = 0;
    for (const destination of destinations) {
      const packlist = await createPacklist(destination);
      const templateId = templateFor(destination);
      const template = templates?.find((entry) => entry.id === templateId);
      if (template) await applyTemplate(packlist.id, template);
      count += 1;
    }
    onDone(count);
  };

  return (
    <Sheet
      title="Build packlists"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={working} onClick={() => void build()}>
            {working ? 'Building…' : `Create ${destinations.length}`}
          </button>
        </>
      }
    >
      <p className="small muted mb-3">
        Pick the starting template for each destination. You can add or drop items on the list itself
        afterwards.
      </p>
      <div className="stack">
        {destinations.map((destination) => (
          <Field key={destination.id} label={destination.name}>
            {(id) => (
              <select
                id={id}
                className="select"
                value={templateFor(destination)}
                onChange={(event) =>
                  setChoices((current) => ({ ...current, [destination.id]: event.target.value }))
                }
              >
                <option value="">Empty list</option>
                {(templates ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
      </div>
    </Sheet>
  );
}
