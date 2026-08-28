import { useEffect, useState } from 'react';
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
import { copyEvent, nextYearDefaults, previewCopy } from '../domain/events';
import type { CopyEventOptions, CopyPreview } from '../domain/events';
import type {
  AccessType,
  Destination,
  DestinationType,
  EventStatus,
  PacklistStatus,
  RaceEvent,
} from '../db/types';
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
  const [copying, setCopying] = useState(false);
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
          <Link className="btn btn-outline btn-sm" to={`/events/${event.id}/warehouse`}>
            📦 Warehouse list
          </Link>
          <Link className="btn btn-outline btn-sm" to={`/events/${event.id}/food`}>
            🍌 Food plan
          </Link>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void handover()}>
            ⬇ Handover file
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setCopying(true)}>
            🗓 Copy for {nextYearDefaults(event).startDate.slice(0, 4)}
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

      {copying ? (
        <CopyEventSheet
          event={event}
          onClose={() => setCopying(false)}
          onDone={(copy) => {
            setCopying(false);
            toast(`${copy.name} created`);
            navigate(`/events/${copy.id}`);
          }}
        />
      ) : null}

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

/**
 * Edit everything about a race, not just its status.
 *
 * Dates move, races get renamed, and a venue changes when a permit falls
 * through. None of that should mean rebuilding the event and its aid stations
 * from scratch, so every field the create form asks for can be changed here.
 */
function EditEventSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const event = useEvent(eventId);
  const toast = useToast();
  // Undefined means untouched, so a field left alone keeps whatever the record
  // says even if it changes underneath us mid-edit from a sync.
  const [draft, setDraft] = useState<Partial<RaceEvent>>({});
  const [saving, setSaving] = useState(false);

  if (!event) return null;

  const field = <K extends keyof RaceEvent>(key: K): RaceEvent[K] => draft[key] ?? event[key];
  const set = <K extends keyof RaceEvent>(key: K, value: RaceEvent[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const name = String(field('name'));
  const startDate = String(field('startDate'));
  const endDate = String(field('endDate'));

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await update(db.events, event.id, {
      name: name.trim(),
      location: String(field('location')).trim(),
      startDate,
      // A blank or earlier end date just mirrors the start, as on the add form.
      endDate: endDate && endDate >= startDate ? endDate : startDate,
      status: field('status'),
      notes: String(field('notes')),
    });
    toast('Event updated');
    onClose();
  };

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
            disabled={!name.trim() || saving}
            onClick={() => void save()}
          >
            Save
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
              onChange={(changed) => set('name', changed.target.value)}
            />
          )}
        </Field>
        <Field label="Location">
          {(id) => (
            <input
              id={id}
              className="input"
              value={String(field('location'))}
              placeholder="Bright, VIC"
              onChange={(changed) => set('location', changed.target.value)}
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
                onChange={(changed) => set('startDate', changed.target.value)}
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
                onChange={(changed) => set('endDate', changed.target.value)}
              />
            )}
          </Field>
        </div>
        {endDate && endDate < startDate ? (
          <p className="tiny muted">The end date is before the start, so it will follow the start.</p>
        ) : null}
        <Field label="Status">
          {(id) => (
            <select
              id={id}
              className="select"
              value={field('status')}
              onChange={(changed) => set('status', changed.target.value as EventStatus)}
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
              value={String(field('notes'))}
              onChange={(changed) => set('notes', changed.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}

/**
 * Roll the whole race over to next year.
 *
 * The dates default to the same weekend rather than the same date — a race on
 * the first Saturday in September stays on a Saturday — and everything is
 * editable before it commits, because a course changes and a venue moves.
 */
function CopyEventSheet({
  event,
  onClose,
  onDone,
}: {
  event: RaceEvent;
  onClose: () => void;
  onDone: (copy: RaceEvent) => void;
}) {
  const [options, setOptions] = useState<CopyEventOptions>(() => nextYearDefaults(event));
  const [preview, setPreview] = useState<CopyPreview>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void previewCopy(event.id).then(setPreview);
  }, [event.id]);

  const set = <K extends keyof CopyEventOptions>(key: K, value: CopyEventOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <Sheet
      title="Copy to next year"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!options.name.trim() || working}
            onClick={() => {
              setWorking(true);
              void copyEvent(event.id, options).then((copy) => {
                if (copy) onDone(copy);
                else setWorking(false);
              });
            }}
          >
            {working ? 'Copying…' : 'Create copy'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          {preview
            ? `${plural(preview.destinations, 'destination')} come across with their access notes, crew leads and timings.`
            : 'Reading this year’s setup…'}
        </p>

        <Field label="Event name">
          {(id) => (
            <input
              id={id}
              className="input"
              value={options.name}
              onChange={(changed) => set('name', changed.target.value)}
            />
          )}
        </Field>
        <Field label="Location">
          {(id) => (
            <input
              id={id}
              className="input"
              value={options.location}
              onChange={(changed) => set('location', changed.target.value)}
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
                value={options.startDate}
                onChange={(changed) => set('startDate', changed.target.value)}
              />
            )}
          </Field>
          <Field label="Ends">
            {(id) => (
              <input
                id={id}
                type="date"
                className="input"
                value={options.endDate}
                onChange={(changed) => set('endDate', changed.target.value)}
              />
            )}
          </Field>
        </div>
        <p className="tiny muted">
          Dates default to the same weekend next year — {formatDateRange(event.startDate, event.endDate)}{' '}
          was a {weekdayOf(event.startDate)}, so this one is too.
        </p>

        {preview?.packlists ? (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.withPacklists}
              onChange={(changed) => set('withPacklists', changed.target.checked)}
            />
            <span>
              <span className="strong">Copy the packlists too</span>
              <span className="small muted" style={{ display: 'block' }}>
                {plural(preview.packlists, 'list')} and {plural(preview.lines, 'line')} come over as
                quantities to pack. Nothing is marked packed, no crates are recreated and no stock
                moves.
              </span>
            </span>
          </label>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Weekday of an ISO date, for explaining why the copy picked its dates. */
function weekdayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'weekend';
  return date.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
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
    const ofType = (templates ?? []).filter((template) => template.appliesTo === destination.type);
    // A per-site list first. The whole-event ones are also filed under the
    // village, and starting a single destination from a 90-line season total is
    // never what was meant.
    const perSite = ofType.filter((template) => template.scope !== 'event');
    // Then the one built for how a vehicle actually reaches this destination:
    // a van-accessible station and a quad drop need different loads.
    const match =
      perSite.find((template) => template.suitsAccess?.includes(destination.access)) ??
      perSite.find((template) => !template.suitsAccess) ??
      perSite[0] ??
      ofType[0];
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
