import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, Field, Pill, ProgressBar, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, liveWhere, update } from '../db/repo';
import { useCrewName, useDestinations } from '../hooks/useDb';
import {
  LOAD_STATUS_LABELS,
  addStop,
  completeLoad,
  deliverStop,
  departLoad,
  loadProgress,
  moveStop,
  removeStop,
  unassignedDestinations,
} from '../domain/transport';
import { PACKLIST_STATUS_LABELS, progressFor } from '../domain/packlists';
import {
  ACCESS_LABELS,
  DESTINATION_ICONS,
  formatDateTime,
  formatTime,
  plural,
} from '../domain/format';
import type { LoadStop } from '../db/types';

/**
 * The driver's screen.
 *
 * It has to work with a phone on a windscreen mount and no reception: the run
 * sheet in order, access notes for each stop, and one big button per stop to
 * confirm delivery with a name.
 */
export default function LoadScreen() {
  const { loadId } = useParams();
  const toast = useToast();
  const crew = useCrewName();

  const load = useLiveQuery(async () => (loadId ? db.loads.get(loadId) : undefined), [loadId]);
  const stops = useLiveQuery(
    async () => (loadId ? liveWhere(db.loadStops, 'loadId', loadId) : []),
    [loadId],
  );
  const destinations = useDestinations(load?.eventId);
  const packlists = useLiveQuery(
    async () => (load ? alive(await db.packlists.where('eventId').equals(load.eventId).toArray()) : []),
    [load?.eventId],
  );
  const lines = useLiveQuery(async () => alive(await db.packlistLines.toArray()), [packlists]);

  const [addingStop, setAddingStop] = useState(false);
  const [delivering, setDelivering] = useState<LoadStop>();
  const [departing, setDeparting] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!load) {
    return (
      <Screen title="Load" back="/transport">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const progress = loadProgress(stops ?? []);
  const available = unassignedDestinations(destinations ?? [], stops ?? []);
  const destinationFor = (id: string) => destinations?.find((entry) => entry.id === id);
  const packlistsFor = (destinationId: string) =>
    (packlists ?? []).filter((packlist) => packlist.destinationId === destinationId);

  return (
    <Screen
      title={load.name}
      subtitle={`${load.vehicle || 'No vehicle'} · ${LOAD_STATUS_LABELS[load.status]}`}
      back="/transport"
      actions={
        <button type="button" className="header-btn" aria-label="Edit load" onClick={() => setEditing(true)}>
          ✎
        </button>
      }
    >
      <div className="card card-pad mb-4">
        <div className="spread mb-2">
          <span className="strong">
            {progress.delivered} / {progress.stops} stops delivered
          </span>
          <Pill tone={load.status === 'complete' ? 'ok' : 'info'}>{LOAD_STATUS_LABELS[load.status]}</Pill>
        </div>
        <ProgressBar percent={progress.percent} done={progress.percent === 100} />
        <div className="small muted mt-3">
          {load.driver ? <div>👤 {load.driver}</div> : null}
          {load.phone ? (
            <div>
              📞 <a href={`tel:${load.phone.replace(/\s+/g, '')}`}>{load.phone}</a>
            </div>
          ) : null}
          {load.departAt ? <div>🕓 Departs {formatDateTime(load.departAt)}</div> : null}
          {load.departedAt ? <div>✅ Left the warehouse {formatDateTime(load.departedAt)}</div> : null}
        </div>
        {load.notes ? <p className="small mt-2">{load.notes}</p> : null}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Run sheet</h2>
          {available.length ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingStop(true)}>
              + Add stop
            </button>
          ) : null}
        </div>

        {stops?.length ? (
          <div className="stack">
            {stops.map((stop, index) => {
              const destination = destinationFor(stop.destinationId);
              const stopLists = packlistsFor(stop.destinationId);
              const delivered = Boolean(stop.arrivedAt);
              return (
                <div key={stop.id} className="card card-pad">
                  <div className="spread mb-2">
                    <div className="row-flex grow">
                      <span className="row-icon">
                        {destination ? DESTINATION_ICONS[destination.type] : '📍'}
                      </span>
                      <div className="grow">
                        <div className="strong">
                          {index + 1}. {destination?.name ?? 'Unknown destination'}
                        </div>
                        <div className="small muted">
                          {destination ? ACCESS_LABELS[destination.access] : ''}
                          {destination?.openTime ? ` · open ${destination.openTime}` : ''}
                        </div>
                      </div>
                    </div>
                    {delivered ? <Pill tone="ok">Delivered</Pill> : null}
                  </div>

                  {destination?.accessNotes ? (
                    <p className="small muted">🚙 {destination.accessNotes}</p>
                  ) : null}

                  {stopLists.length ? (
                    <div className="list mt-2">
                      {stopLists.map((packlist) => {
                        const packProgress = progressFor(
                          (lines ?? []).filter((line) => line.packlistId === packlist.id),
                        );
                        return (
                          <Link key={packlist.id} to={`/packlists/${packlist.id}`} className="row">
                            <span className="row-body">
                              <span className="row-title truncate">{packlist.name}</span>
                              <span className="row-sub mono">{packlist.code}</span>
                            </span>
                            <span className="row-end">
                              <Pill tone={packProgress.percent === 100 ? 'ok' : 'accent'}>
                                {PACKLIST_STATUS_LABELS[packlist.status]}
                              </Pill>
                              <div className="tiny muted mt-2">
                                {packProgress.linesDone}/{packProgress.linesTotal} lines
                              </div>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="small muted mt-2">No packlist built for this destination yet.</p>
                  )}

                  {delivered ? (
                    <p className="small mt-3">
                      ✅ {formatTime(stop.arrivedAt)}
                      {stop.signedBy ? ` · signed by ${stop.signedBy}` : ''}
                      {stop.notes ? ` · ${stop.notes}` : ''}
                    </p>
                  ) : (
                    <div className="btn-row mt-3">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setDelivering(stop)}
                      >
                        Confirm delivery
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        aria-label="Move stop earlier"
                        disabled={index === 0}
                        onClick={() => void moveStop(stops, stop.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        aria-label="Move stop later"
                        disabled={index === stops.length - 1}
                        onClick={() => void moveStop(stops, stop.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Remove stop"
                        onClick={() => void removeStop(stop.id).then(() => toast('Stop removed'))}
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card card-pad center muted">
            No stops yet.{' '}
            {available.length ? (
              <button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => setAddingStop(true)}>
                Add the first stop
              </button>
            ) : (
              'Add destinations to the event first.'
            )}
          </div>
        )}
      </section>

      {load.status === 'planned' || load.status === 'loading' ? (
        <div className="action-bar no-print">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!stops?.length}
            onClick={() => setDeparting(true)}
          >
            🚚 Depart warehouse
          </button>
        </div>
      ) : load.status !== 'complete' && progress.percent === 100 ? (
        <div className="action-bar no-print">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void completeLoad(load.id).then(() => toast('Load complete'))}
          >
            ✅ Finish this run
          </button>
        </div>
      ) : null}

      {addingStop ? (
        <Sheet title="Add a stop" onClose={() => setAddingStop(false)}>
          <div className="list">
            {available.map((destination) => (
              <button
                key={destination.id}
                type="button"
                className="row"
                onClick={() => {
                  void addStop(load.id, destination.id).then(() => {
                    toast('Stop added');
                    setAddingStop(false);
                  });
                }}
              >
                <span className="row-icon">{DESTINATION_ICONS[destination.type]}</span>
                <span className="row-body">
                  <span className="row-title">{destination.name}</span>
                  <span className="row-sub">{ACCESS_LABELS[destination.access]}</span>
                </span>
                <span className="row-chevron">›</span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}

      {delivering ? (
        <DeliverSheet
          stopName={destinationFor(delivering.destinationId)?.name ?? 'this stop'}
          listCount={packlistsFor(delivering.destinationId).length}
          onClose={() => setDelivering(undefined)}
          onConfirm={(signedBy, notes) => {
            const stop = delivering;
            setDelivering(undefined);
            void deliverStop(stop, { signedBy, notes, by: crew }).then(() => toast('Delivery recorded'));
          }}
        />
      ) : null}

      {departing ? (
        <ConfirmSheet
          title="Depart the warehouse?"
          body={
            <>
              Everything on board is marked loaded and comes off the warehouse shelves — across{' '}
              {plural(progress.stops, 'stop')}.
            </>
          }
          confirmLabel="Depart"
          onCancel={() => setDeparting(false)}
          onConfirm={() => {
            setDeparting(false);
            void departLoad(load, crew).then(() => toast('On the road — stock issued'));
          }}
        />
      ) : null}

      {editing ? <EditLoadSheet loadId={load.id} onClose={() => setEditing(false)} /> : null}
    </Screen>
  );
}

/** Delivery confirmation: who took it, and anything that went wrong. */
function DeliverSheet({
  stopName,
  listCount,
  onClose,
  onConfirm,
}: {
  stopName: string;
  listCount: number;
  onClose: () => void;
  onConfirm: (signedBy: string, notes: string) => void;
}) {
  const [signedBy, setSignedBy] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Sheet
      title={`Delivered to ${stopName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(signedBy.trim(), notes.trim())}>
            Confirm
          </button>
        </>
      }
    >
      <p className="small muted mb-3">
        {listCount ? `${plural(listCount, 'packlist')} will be marked delivered.` : 'No packlists at this stop.'}
      </p>
      <div className="stack">
        <Field label="Received by" hint="Aid station lead or whoever took the crates.">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              value={signedBy}
              onChange={(event) => setSignedBy(event.target.value)}
            />
          )}
        </Field>
        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={notes}
              placeholder="Left two cubes at the gate — track too wet."
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}

function EditLoadSheet({ loadId, onClose }: { loadId: string; onClose: () => void }) {
  const load = useLiveQuery(async () => db.loads.get(loadId), [loadId]);
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (!load) return null;
  const value = (key: 'name' | 'vehicle' | 'driver' | 'phone' | 'notes') => draft[key] ?? load[key];

  return (
    <Sheet
      title="Edit load"
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
              void update(db.loads, load.id, {
                name: value('name'),
                vehicle: value('vehicle'),
                driver: value('driver'),
                phone: value('phone'),
                notes: value('notes'),
              }).then(() => {
                toast('Load updated');
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
        {(['name', 'vehicle', 'driver', 'phone'] as const).map((key) => (
          <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
            {(id) => (
              <input
                id={id}
                className="input"
                value={value(key)}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
              />
            )}
          </Field>
        ))}
        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={value('notes')}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
