import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { MovePill, MoveStrip } from '../components/Moves';
import { ConfirmSheet, EmptyState, Field, Pill, ProgressBar, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, create, nextSort, softDelete, softDeleteChildren, update } from '../db/repo';
import { useDestinations, useEvent } from '../hooks/useDb';
import {
  defaultTemplateFor,
  describeSource,
  primaryPacklist,
  progressFor,
  startPacklist,
} from '../domain/packlists';
import { boardCounts, currentMove, moveOf, moveProgress } from '../domain/moves';
import type { Move } from '../domain/moves';
import {
  ACCESS_LABELS,
  DESTINATION_ICONS,
  DESTINATION_LABELS,
  EVENT_STATUS_LABELS,
  formatDateRange,
  formatQty,
  plural,
  relativeDays,
} from '../domain/format';
import { gearStillOut } from '../domain/returns';
import type {
  AccessType,
  Destination,
  DestinationType,
  EventStatus,
  Packlist,
  RaceEvent,
} from '../db/types';
import { ACCESS_TYPES, DESTINATION_TYPES, EVENT_STATUSES } from '../db/types';

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
  const [editingDestination, setEditingDestination] = useState<Destination>();
  const [editing, setEditing] = useState(false);
  const [buildingLists, setBuildingLists] = useState(false);
  const [removing, setRemoving] = useState<Destination>();
  const [showing, setShowing] = useState<Move | null>(null);
  const truckStage = Boolean(event?.truckStage);

  // Packlists, where each one is up to, keyed by destination for the list below.
  const summaries = useLiveQuery(async () => {
    if (!eventId) return new Map<string, { move: Move; percent: number; id: string; blocking: number; lists: number }>();
    const packlists = alive(await db.packlists.where('eventId').equals(eventId).toArray());
    const allLines = alive(await db.packlistLines.toArray());
    const linesOf = (packlist: Packlist) => allLines.filter((line) => line.packlistId === packlist.id);
    const byDestination = new Map<string, Packlist[]>();
    for (const packlist of packlists) {
      byDestination.set(packlist.destinationId, [...(byDestination.get(packlist.destinationId) ?? []), packlist]);
    }
    const map = new Map<string, { move: Move; percent: number; id: string; blocking: number; lists: number }>();
    for (const [destinationId, candidates] of byDestination) {
      const packlist = primaryPacklist(candidates, (entry) => linesOf(entry).length);
      if (!packlist) continue;
      const own = linesOf(packlist);
      const move = moveOf(own, truckStage, packlist.status);
      map.set(destinationId, {
        id: packlist.id,
        move,
        percent: moveProgress(own, move, truckStage).percent,
        blocking: progressFor(own).blocking.length,
        lists: candidates.length,
      });
    }
    return map;
  }, [eventId, destinations, truckStage]);

  // The board's strip: every station with a list sits at a move; one without
  // a list is still being planned.
  const rows = (destinations ?? []).map((destination) => ({
    move: summaries?.get(destination.id)?.move ?? ('plan' as Move),
  }));
  const counts = boardCounts(rows);
  const current = currentMove(rows, truckStage);

  if (!event) {
    return (
      <Screen title="Event" back="/events">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const withoutPacklist = (destinations ?? []).filter((destination) => !summaries?.get(destination.id));

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
        <div className="btn-grid mt-3">
          <Link className="btn btn-outline btn-sm" to={`/events/${event.id}/warehouse`}>
            📦 Warehouse list
          </Link>
          {truckStage ? (
            <Link className="btn btn-outline btn-sm" to={`/events/${event.id}/vans`}>
              🚐 Vans
            </Link>
          ) : null}
          <Link className="btn btn-outline btn-sm" to={`/events/${event.id}/home`}>
            🏠 Home
          </Link>
          <Link className="btn btn-outline btn-sm" to={`/events/${event.id}/food`}>
            🍌 Food plan
          </Link>
          <Link className="btn btn-outline btn-sm" to={`/import?event=${event.id}`}>
            📄 Import pack list
          </Link>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Destinations</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingDestination(true)}>
            + Add
          </button>
        </div>

        {destinations?.length ? (
          <MoveStrip
            counts={counts}
            current={current}
            truckStage={truckStage}
            selected={showing}
            onSelect={setShowing}
          />
        ) : null}

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
          {(destinations ?? [])
            .filter((destination) => !showing || (summaries?.get(destination.id)?.move ?? 'plan') === showing)
            .map((destination) => {
            const summary = summaries?.get(destination.id);
            return (
              <button
                key={destination.id}
                type="button"
                className="row"
                onClick={() => {
                  if (summary) navigate(`/packlists/${summary.id}`);
                  else
                    void startPacklist(destination).then(({ packlist, source }) => {
                      toast(describeSource(source));
                      navigate(`/packlists/${packlist.id}`);
                    });
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
                      <MovePill move={summary.move} truckStage={truckStage} />
                      {summary.blocking ? (
                        <div className="tiny" style={{ color: 'var(--danger)', marginTop: 4 }}>
                          {summary.blocking} short
                        </div>
                      ) : null}
                      {/* Only one list opens from here, so a second one would
                          otherwise show up only as doubled warehouse totals. */}
                      {summary.lists > 1 ? (
                        <div className="tiny" style={{ color: 'var(--warn)', marginTop: 4 }}>
                          {summary.lists} lists
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Pill tone="accent">Start list</Pill>
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
                  onClick={() => setEditingDestination(destination)}
                  aria-label={`Edit ${destination.name}`}
                >
                  ✎
                </button>
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

      {editingDestination ? (
        <DestinationSheet
          eventId={event.id}
          existing={destinations ?? []}
          destination={editingDestination}
          onClose={() => setEditingDestination(undefined)}
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
              // Gear out against this station comes home on its list; without
              // the list it drops off the count for good.
              const out = await gearStillOut(target.id);
              if (out > 0) {
                toast(`${formatQty(out, 'each')} of this station's gear is still out of the warehouse. Count it home first.`, 'warn');
                return;
              }
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
/**
 * Add a destination, or change one that exists.
 *
 * Stations get renamed when the council moves the carpark, the course km
 * shifts with a reroute, and the crew lead changes the week before. None of
 * that should mean removing the station and losing its packlist, so the same
 * form that creates a destination edits it when given one.
 */
function DestinationSheet({
  eventId,
  existing,
  destination,
  onClose,
}: {
  eventId: string;
  existing: Destination[];
  /** When set, the sheet edits this destination instead of adding a new one. */
  destination?: Destination;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(destination?.name ?? '');
  const [type, setType] = useState<DestinationType>(destination?.type ?? 'aid_station');
  const [courseKm, setCourseKm] = useState(
    destination?.courseKm === null || destination?.courseKm === undefined ? '' : String(destination.courseKm),
  );
  const [access, setAccess] = useState<AccessType>(destination?.access ?? '2wd');
  const [accessNotes, setAccessNotes] = useState(destination?.accessNotes ?? '');
  const [crewLead, setCrewLead] = useState(destination?.crewLead ?? '');
  const [vehicle, setVehicle] = useState(destination?.vehicle ?? '');
  // Vehicles already named on this event, so the same van is spelt the same way.
  const vehicles = [...new Set(existing.map((entry) => entry.vehicle?.trim()).filter(Boolean))].sort();
  const [openTime, setOpenTime] = useState(destination?.openTime ?? '');
  const [closeTime, setCloseTime] = useState(destination?.closeTime ?? '');

  const save = async () => {
    if (!name.trim()) return;
    if (destination) {
      await update(db.destinations, destination.id, {
        name: name.trim(),
        type,
        courseKm: courseKm.trim() ? Number(courseKm) : null,
        access,
        accessNotes: accessNotes.trim(),
        crewLead: crewLead.trim(),
        vehicle: vehicle.trim(),
        openTime,
        closeTime,
      });
      // A packlist still called what the station used to be called follows the
      // rename. One given its own name is left alone.
      if (name.trim() !== destination.name) {
        const packlists = alive(
          await db.packlists.where('destinationId').equals(destination.id).toArray(),
        );
        for (const packlist of packlists) {
          if (packlist.name === destination.name) {
            await update(db.packlists, packlist.id, { name: name.trim() });
          }
        }
      }
      toast('Destination updated');
      onClose();
      return;
    }
    const created = await create(db.destinations, {
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
      vehicle: vehicle.trim(),
      openTime,
      closeTime,
      notes: '',
      sort: nextSort(existing),
    });
    // The list starts with the station, from last year's list for the same
    // station where there was one, so nobody builds Borough Huts from nothing.
    const { source } = await startPacklist(created);
    toast(`Destination added. ${describeSource(source)}.`);
    onClose();
  };

  return (
    <Sheet
      title={destination ? 'Edit destination' : 'New destination'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            {destination ? 'Save' : 'Add'}
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
        <div className="field-row">
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
          <Field label="Vehicle" hint="Which van or ute carries this station's gear.">
            {(id) => (
              <>
                <input
                  id={id}
                  className="input"
                  list={`${id}-vehicles`}
                  value={vehicle}
                  placeholder="Van 3"
                  onChange={(event) => setVehicle(event.target.value)}
                />
                <datalist id={`${id}-vehicles`}>
                  {vehicles.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
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
      truckStage: Boolean(field('truckStage')),
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
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(field('truckStage'))}
            onChange={(changed) => set('truckStage', changed.target.checked)}
          />
          <span>
            <span className="strong">Truck stage</span>
            <span className="small muted" style={{ display: 'block' }}>
              Everything goes out in one truck, then into a van per station at the event. The
              warehouse list ticks gear onto the truck; each station's list is its van pack.
            </span>
          </span>
        </label>
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

  /** '' is the automatic start: last edition, then the type's template. */
  const AUTO = '';
  const EMPTY = '__empty';
  const choiceFor = (destination: Destination) => choices[destination.id] ?? AUTO;
  const fallbackName = (destination: Destination) =>
    defaultTemplateFor(destination, templates ?? [])?.name ?? 'an empty list';

  const build = async () => {
    setWorking(true);
    let count = 0;
    for (const destination of destinations) {
      const choice = choiceFor(destination);
      await startPacklist(destination, {
        templateId: choice === EMPTY ? null : choice || undefined,
        templates: templates ?? [],
      });
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
        Each station starts from its own list at the last edition of this event where there was one,
        otherwise from the template for its kind of station. Pick a template here to start from that
        instead. You can add or drop items on the list itself afterwards.
      </p>
      <div className="stack">
        {destinations.map((destination) => (
          <Field key={destination.id} label={destination.name}>
            {(id) => (
              <select
                id={id}
                className="select"
                value={choiceFor(destination)}
                onChange={(event) =>
                  setChoices((current) => ({ ...current, [destination.id]: event.target.value }))
                }
              >
                <option value={AUTO}>Last edition, else {fallbackName(destination)}</option>
                <option value={EMPTY}>Empty list</option>
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
