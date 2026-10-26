import { useState } from 'react';
import { Field, Sheet } from './ui';
import { useToast } from './toastContext';
import { db } from '../db/db';
import { update } from '../db/repo';
import type { Destination, StationSchedule, StationWindow } from '../db/types';
import { compareUnits } from '../domain/units';

/**
 * A station's schedule: one window per race or stage coming through, each
 * with its first runner and cut-off, and the set-up, pack-down, power and
 * internet the run sheet opens with. On a multi-day course one open and
 * close time cannot hold this; Mt William opens for Stage 2, the miler
 * overnight and the Stage 3 start.
 */
export function ScheduleSheet({ destination, onClose }: { destination: Destination; onClose: () => void }) {
  const toast = useToast();
  const start = destination.schedule;
  const [windows, setWindows] = useState<StationWindow[]>(start?.windows ?? []);
  const [departsAt, setDepartsAt] = useState(start?.departsAt ?? '');
  const [setup, setSetup] = useState(start?.setup ?? '');
  const [packDown, setPackDown] = useState(start?.packDown ?? '');
  const [power, setPower] = useState(start?.power ?? '');
  const [connectivity, setConnectivity] = useState(start?.connectivity ?? '');
  const [units, setUnits] = useState((start?.units ?? []).join(', '));

  const change = (index: number, patch: Partial<StationWindow>) =>
    setWindows((current) => current.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  // A cut-off before its first runner is a typo, and the run sheet would print it.
  const backwards = windows.some((entry) => entry.firstRunner && entry.cutoff && entry.cutoff < entry.firstRunner);

  const save = () => {
    const schedule: StationSchedule = {
      windows: windows
        .map((entry) => ({ ...entry, label: entry.label.trim() }))
        .filter((entry) => entry.label || entry.firstRunner || entry.cutoff),
      departsAt: departsAt || null,
      setup: setup.trim(),
      packDown: packDown.trim(),
      power: power.trim(),
      connectivity: connectivity.trim(),
      units: [...new Set(units.split(',').map((entry) => entry.trim()).filter(Boolean))].sort(compareUnits),
    };
    void update(db.destinations, destination.id, { schedule }).then(() => {
      toast('Schedule saved');
      onClose();
    });
  };

  return (
    <Sheet
      title={`${destination.name}: schedule`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={backwards} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small strong">When it is open</p>
        {windows.map((entry, index) => (
          <div key={index} className="card card-pad stack-sm">
            <Field label="Race or stage">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={entry.label}
                  placeholder="Miler"
                  onChange={(event) => change(index, { label: event.target.value })}
                />
              )}
            </Field>
            <Field label="First runner">
              {(id) => (
                <input
                  id={id}
                  type="datetime-local"
                  className="input"
                  value={entry.firstRunner ?? ''}
                  onChange={(event) => change(index, { firstRunner: event.target.value || null })}
                />
              )}
            </Field>
            <Field label="Cut-off" hint="Leave blank for a start line, which closes once the field is away.">
              {(id) => (
                <input
                  id={id}
                  type="datetime-local"
                  className="input"
                  value={entry.cutoff ?? ''}
                  onChange={(event) => change(index, { cutoff: event.target.value || null })}
                />
              )}
            </Field>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setWindows((current) => current.filter((_, at) => at !== index))}
            >
              Remove this window
            </button>
          </div>
        ))}
        {backwards ? (
          <p className="tiny" style={{ color: 'var(--danger)' }}>
            A cut-off is before its first runner.
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setWindows((current) => [...current, { label: '', firstRunner: null, cutoff: null }])}
        >
          + Add a window
        </button>

        <Field label="Vehicle leaves the yard" hint="Orders the van packs at the yard: first out, packed first.">
          {(id) => (
            <input
              id={id}
              type="datetime-local"
              className="input"
              value={departsAt}
              onChange={(event) => setDepartsAt(event.target.value)}
            />
          )}
        </Field>
        <Field label="Set-up">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={setup}
              placeholder="Thu 04:30 Pantech #1 departs Halls Gap, set up by 06:15"
              onChange={(event) => setSetup(event.target.value)}
            />
          )}
        </Field>
        <Field label="Pack-down and next move">
          {(id) => (
            <textarea id={id} className="textarea" value={packDown} onChange={(event) => setPackDown(event.target.value)} />
          )}
        </Field>
        <Field label="Power">
          {(id) => (
            <input
              id={id}
              className="input"
              value={power}
              placeholder="EcoFlow #1, generator, light tower"
              onChange={(event) => setPower(event.target.value)}
            />
          )}
        </Field>
        <Field label="Internet">
          {(id) => (
            <input
              id={id}
              className="input"
              value={connectivity}
              placeholder="Starlink 2, or 5G"
              onChange={(event) => setConnectivity(event.target.value)}
            />
          )}
        </Field>
        <Field label="Units here" hint="Named units at this station, separated by commas: Starlink 2, EcoFlow #1.">
          {(id) => <input id={id} className="input" value={units} onChange={(event) => setUnits(event.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}
