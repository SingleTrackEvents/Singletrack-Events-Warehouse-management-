import { Field, Pill } from './ui';
import { useDestinations, useEvents } from '../hooks/useDb';
import { grantOf, scopeOf } from '../domain/accessDraft';
import type { AccessDraft } from '../domain/accessDraft';
import { presetAccess } from '../sync/permissions';
import { ACCESS_OPTIONS, ROLE_BLURBS, ROLE_LABELS } from '../sync/types';
import type { Role } from '../sync/types';

/**
 * Who someone is and what they can reach: the role, the event, the station
 * and the tick boxes. One editor for a new invite, a change to an invite, and
 * a change to one person, so the three never drift apart.
 */

export function AccessEditor({
  draft,
  onChange,
  roles = ['volunteer', 'driver', 'crew'],
  roleLabel = 'Who is it for?',
}: {
  draft: AccessDraft;
  onChange: (next: AccessDraft) => void;
  roles?: Role[];
  roleLabel?: string;
}) {
  const events = useEvents();
  const destinations = useDestinations(draft.eventId || undefined);
  const scope = scopeOf(draft);
  const access = grantOf(draft).access;
  const event = events?.find((entry) => entry.id === draft.eventId);
  const destination = destinations?.find((entry) => entry.id === draft.destinationId);
  const needsDestination = draft.role === 'volunteer';
  const needsEvent = draft.role === 'volunteer' || draft.role === 'driver';

  // Boxes follow the role and the event until someone changes one by hand.
  const change = (next: Partial<AccessDraft>) => {
    const merged = { ...draft, ...next };
    if (!merged.touched) merged.picked = presetAccess(merged.role, scopeOf(merged));
    onChange(merged);
  };

  return (
    <>
      <Field label={roleLabel}>
        {() => (
          <div className="chip-row" role="group" aria-label={roleLabel}>
            {roles.map((option) => (
              <button
                key={option}
                type="button"
                className="chip"
                aria-pressed={draft.role === option}
                onClick={() =>
                  change({
                    role: option,
                    destinationId: option === 'volunteer' ? draft.destinationId : '',
                  })
                }
              >
                {ROLE_LABELS[option]}
              </button>
            ))}
          </div>
        )}
      </Field>
      <p className="tiny muted">{ROLE_BLURBS[draft.role]}</p>

      {draft.role === 'admin' ? null : (
        <>
          <Field
            label="Event"
            hint={
              draft.role === 'crew' && !draft.eventId
                ? 'Every event, plus the warehouse: stock, stocktakes and templates.'
                : undefined
            }
          >
            {(id) => (
              <select
                id={id}
                className="select"
                value={draft.eventId}
                onChange={(e) => change({ eventId: e.target.value, destinationId: '' })}
              >
                <option value="">{needsEvent ? 'Choose an event' : 'All events (warehouse crew)'}</option>
                {(events ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {draft.eventId ? (
            <Field
              label="Aid station"
              hint={
                needsDestination
                  ? 'They see only this station’s list.'
                  : 'Leave on every station unless they only work one.'
              }
            >
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={draft.destinationId}
                  onChange={(e) => change({ destinationId: e.target.value })}
                >
                  <option value="">{needsDestination ? 'Choose a station' : 'Every station'}</option>
                  {(destinations ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}

          <div>
            <div className="spread">
              <span className="small strong">What they can do</span>
              {access ? <Pill tone="accent">Custom</Pill> : null}
            </div>
            {/*
              A volunteer is kept to one station, and the station hint above
              already says so. This line used to say "the packlists for" the
              event right under "this station's packlist and no other", which
              read as if they saw every station.
            */}
            {needsDestination ? null : (
              <p className="tiny muted mt-1">
                {destination
                  ? `They always see ${destination.name}’s list.`
                  : `They always see the station lists for ${event ? event.name : 'every event'}.`}
              </p>
            )}
            {ACCESS_OPTIONS.map((option) => {
              const off = Boolean(option.warehouse && scope.eventId);
              return (
                <label key={option.key} className="checkbox" style={{ opacity: off ? 0.45 : 1 }}>
                  <input
                    type="checkbox"
                    disabled={off}
                    checked={!off && draft.picked.includes(option.key)}
                    onChange={(changed) =>
                      onChange({
                        ...draft,
                        touched: true,
                        picked: changed.target.checked
                          ? [...draft.picked, option.key]
                          : draft.picked.filter((key) => key !== option.key),
                      })
                    }
                  />
                  <span>
                    <span className="strong">{option.label}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {off ? 'Only with all events.' : option.hint}
                    </span>
                  </span>
                </label>
              );
            })}
            {access ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => onChange({ ...draft, touched: false, picked: presetAccess(draft.role, scope) })}
              >
                Back to the usual for {ROLE_LABELS[draft.role].toLowerCase()}s
              </button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
