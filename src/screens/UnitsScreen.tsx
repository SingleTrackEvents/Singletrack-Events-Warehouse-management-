import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Screen } from '../App';
import { EmptyState, Pill, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useDestinations, useEvent } from '../hooks/useDb';
import { moveUnit, unitPlaces } from '../domain/units';
import type { UnitPlace } from '../domain/units';

/**
 * Where every named unit is: Starlink 3 at Rosea, EcoFlow #1 at Mt Difficult
 * Rd. Over the weekend they move station to station, and this is the answer
 * to "who has the spare Starlink" without a round of WhatsApp messages.
 */
export default function UnitsScreen() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const destinations = useDestinations(eventId);
  const toast = useToast();
  const [moving, setMoving] = useState<UnitPlace>();

  if (!event || !destinations) {
    return (
      <Screen title="Units" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const places = unitPlaces(destinations);

  return (
    <Screen title="Units" subtitle={event.name} back={`/events/${event.id}`}>
      {places.length ? (
        <div className="list">
          {places.map((place) => (
            <button key={place.unit} type="button" className="row" onClick={() => setMoving(place)}>
              <span className="row-icon">🏷️</span>
              <span className="row-body">
                <span className="row-title">{place.unit}</span>
                <span className="row-sub">{place.at.map((entry) => entry.name).join(', ')}</span>
              </span>
              <span className="row-end">
                {place.at.length > 1 ? <Pill tone="warn">In {place.at.length} places</Pill> : <span className="row-chevron">›</span>}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          glyph="🏷️"
          title="No named units yet"
          body="Add Starlinks, EcoFlows and light towers to a station's schedule, and this shows where each one is."
          action={
            <Link className="btn btn-primary" to={`/events/${event.id}`}>
              Open the stations
            </Link>
          }
        />
      )}

      {moving ? (
        <Sheet title={`Move ${moving.unit}`} onClose={() => setMoving(undefined)}>
          <div className="list">
            {destinations.map((destination) => (
              <button
                key={destination.id}
                type="button"
                className="row"
                onClick={() => {
                  const unit = moving.unit;
                  setMoving(undefined);
                  void moveUnit(event.id, unit, destination.id).then(() => toast(`${unit} is at ${destination.name}`));
                }}
              >
                <span className="row-body">
                  <span className="row-title">{destination.name}</span>
                </span>
                {moving.at.some((entry) => entry.id === destination.id) ? <Pill tone="ok">Here now</Pill> : null}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </Screen>
  );
}
