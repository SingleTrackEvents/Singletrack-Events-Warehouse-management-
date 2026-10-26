import type { Destination } from '../db/types';
import { stationHours, whatsappLink } from '../domain/runSheet';

/**
 * The top of a station's run sheet: hours, crew lead, vehicle, power and
 * internet, and how to get in. At body size, because the paper sheet it
 * replaces opens with exactly these and nobody reads 12px grey in the sun.
 */
export function RunSheetCard({ destination }: { destination: Destination }) {
  const hours = stationHours(destination);
  const chat = whatsappLink(destination.phone);
  const schedule = destination.schedule;
  const facts: Array<[string, string]> = [];
  if (destination.vehicle) facts.push(['🚐 Vehicle', destination.vehicle]);
  if (schedule?.power) facts.push(['🔋 Power', schedule.power]);
  if (schedule?.connectivity) facts.push(['📶 Internet', schedule.connectivity]);
  if (schedule?.units?.length) facts.push(['🏷️ Units here', schedule.units.join(', ')]);

  return (
    <div className="card card-pad mb-3 run-sheet">
      <div className="run-sheet-row">
        <span className="run-sheet-label">🕑 Hours</span>
        <span>
          {hours.length ? (
            hours.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))
          ) : (
            <span className="muted">Not set yet. Ask your crew lead.</span>
          )}
        </span>
      </div>
      <div className="run-sheet-row">
        <span className="run-sheet-label">🧑 Crew lead</span>
        <span>
          {destination.crewLead || <span className="muted">Not set yet</span>}
          {destination.phone ? <span className="block muted">{destination.phone}</span> : null}
        </span>
      </div>
      {chat ? (
        <a className="btn btn-brand btn-block mt-2 mb-2 no-print" href={chat} target="_blank" rel="noreferrer">
          💬 WhatsApp {destination.crewLead || 'the crew lead'}
        </a>
      ) : null}
      {facts.map(([label, value]) => (
        <div key={label} className="run-sheet-row">
          <span className="run-sheet-label">{label}</span>
          <span>{value}</span>
        </div>
      ))}
      {destination.accessNotes ? (
        <div className="run-sheet-row">
          <span className="run-sheet-label">🚙 Access</span>
          <span>{destination.accessNotes}</span>
        </div>
      ) : null}
      {schedule?.setup ? (
        <div className="run-sheet-row">
          <span className="run-sheet-label">🏗️ Set-up</span>
          <span>{schedule.setup}</span>
        </div>
      ) : null}
      {schedule?.packDown ? (
        <div className="run-sheet-row">
          <span className="run-sheet-label">📦 Pack-down</span>
          <span>{schedule.packDown}</span>
        </div>
      ) : null}
    </div>
  );
}
