import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Field, Pill, Sheet, Stepper } from '../components/ui';
import { ItemPicker } from '../components/ItemPicker';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { byId, create, nextSort, softDelete, update } from '../db/repo';
import { FOOD_CATEGORY } from '../db/foodCatalogue';
import { seedId } from '../db/seed';
import {
  useConsumptionLines,
  useDestinations,
  useEvent,
  useItems,
  useRaces,
} from '../hooks/useDb';
import {
  applyPlanToPacklists,
  addPlanItems,
  copyRuleForRace,
  dayLabel,
  dayShort,
  eventDays,
  lineQtyByDay,
  sortDays,
  stationRunners,
  stationRunnersByDay,
  stationVisits,
  totalsToOrder,
} from '../domain/consumption';
import { downloadCsv, slugify } from '../domain/backup';
import { DESTINATION_ICONS, formatQty, plural } from '../domain/format';
import type { ConsumptionLine, Destination, Race, RaceEvent, RaceVisit } from '../db/types';

/**
 * The food plan: projections in, shopping list and aid station quantities out.
 *
 * Everything on this screen is a rule rather than a number — races carry
 * projected fields and the day they run, stations carry ratios per race — so
 * when a projection moves a fortnight out, every station and the order list
 * move with it, and a two-day weekend reads as Saturday and Sunday. The
 * computed quantities land on the packlists, which is where packing happens.
 */
export default function FoodScreen() {
  const { eventId } = useParams();
  const toast = useToast();
  const event = useEvent(eventId);
  const destinations = useDestinations(eventId);
  const races = useRaces(eventId);
  const lines = useConsumptionLines(eventId);
  const items = useItems();

  const [addingRace, setAddingRace] = useState(false);
  const [removingRace, setRemovingRace] = useState<Race>();
  const [linkingRaces, setLinkingRaces] = useState<Destination>();
  const [addingItems, setAddingItems] = useState<Destination>();
  const [editingLine, setEditingLine] = useState<ConsumptionLine>();
  const [applying, setApplying] = useState(false);
  const [working, setWorking] = useState(false);

  const itemById = useMemo(() => byId(items ?? []), [items]);
  const totals = useMemo(
    () => totalsToOrder(lines ?? [], destinations ?? [], races ?? [], items ?? []),
    [lines, destinations, races, items],
  );
  const projected = (races ?? []).reduce((sum, race) => sum + race.projection, 0);
  const shortfalls = totals.filter((total) => total.toOrder > 0);
  const plannedStations = new Set((lines ?? []).map((line) => line.destinationId)).size;
  // Once any race carries a date the whole plan reads by day.
  const hasDays = (races ?? []).some((race) => race.day);
  const days = useMemo(
    () => sortDays(totals.flatMap((total) => total.byDay.map(([day]) => day))),
    [totals],
  );

  if (!event) {
    return (
      <Screen title="Food plan" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const raceName = (raceId: string | null | undefined) =>
    (races ?? []).find((race) => race.id === raceId)?.name;

  const raceSummary = (destination: Destination) =>
    stationVisits(destination, races ?? [])
      .map((visit) => (visit.passes > 1 ? `${visit.race.name} ×${visit.passes}` : visit.race.name))
      .join(', ');

  const runnersLabel = (destination: Destination) => {
    if (!hasDays) return `${stationRunners(destination, races ?? [])} through`;
    const byDay = stationRunnersByDay(destination, races ?? []);
    if (!byDay.length) return '0 through';
    return byDay.map(([day, runners]) => `${dayShort(day)} ${runners}`).join(' · ');
  };

  const splitLabel = (byDay: Array<[string | null, number]>) =>
    byDay.map(([day, qty]) => `${dayShort(day)} ${qty}`).join(' · ');

  const exportOrder = () => {
    const dayColumns = hasDays ? days.map((day) => dayLabel(day)) : [];
    downloadCsv(
      [
        ['Item', 'Unit', 'Needed', ...dayColumns, 'On hand', 'To order'],
        ...totals.map((total) => [
          total.item.name,
          total.item.unit,
          String(total.total),
          ...(hasDays
            ? days.map((day) => String(total.byDay.find(([when]) => when === day)?.[1] ?? 0))
            : []),
          String(total.onHand),
          String(total.toOrder),
        ]),
      ],
      `${slugify(event.name)}-food-order.csv`,
    );
    toast('Order list saved to downloads');
  };

  const apply = async () => {
    setWorking(true);
    const result = await applyPlanToPacklists(event.id, destinations ?? []);
    setWorking(false);
    setApplying(false);
    if (!result.stations) {
      toast('Nothing to send yet — the plan computes to zero', 'warn');
      return;
    }
    toast(
      `${plural(result.stations, 'packlist')} updated` +
        (result.created ? `, ${result.created} created` : ''),
    );
  };

  const dayOptions = eventDays(event);

  return (
    <Screen title="Food plan" subtitle={event.name} back={`/events/${event.id}`}>
      {/* ------------------------------------------------------------ races */}
      <section className="section">
        <div className="section-head">
          <h2>Races</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingRace(true)}>
            + Add
          </button>
        </div>

        {races && !races.length ? (
          <EmptyState
            glyph="🏃"
            title="No races yet"
            body="Add each distance and its projected field. Every aid station quantity is worked out from these numbers."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAddingRace(true)}>
                Add a race
              </button>
            }
          />
        ) : null}

        <div className="list">
          {(races ?? []).map((race) => (
            <div key={race.id} className="row row-static">
              <span className="row-body">
                <span className="row-title">{race.name}</span>
                {dayOptions.length > 1 ? (
                  <select
                    className="select"
                    style={{ marginTop: 4, minHeight: 36, padding: '4px 8px', fontSize: 'var(--text-sm)' }}
                    aria-label={`${race.name} day`}
                    value={race.day ?? ''}
                    onChange={(changed) =>
                      void update(db.races, race.id, { day: changed.target.value || null })
                    }
                  >
                    <option value="">Day not set</option>
                    {dayOptions.map((day) => (
                      <option key={day} value={day}>
                        {dayLabel(day)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="row-sub">projected starters</span>
                )}
              </span>
              <span className="row-end">
                <Stepper
                  label={`${race.name} projection`}
                  value={race.projection}
                  min={0}
                  step={5}
                  onChange={(next) => void update(db.races, race.id, { projection: next })}
                />
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${race.name}`}
                onClick={() => setRemovingRace(race)}
              >
                🗑
              </button>
            </div>
          ))}
          {races?.length ? (
            <div className="row row-static">
              <span className="row-body">
                <span className="row-title">Total</span>
              </span>
              <span className="row-end strong">{projected} runners</span>
            </div>
          ) : null}
        </div>
        {dayOptions.length > 1 && !hasDays ? (
          <p className="tiny muted mt-2">
            Give each race its day and every station and the order list split into Saturday and
            Sunday.
          </p>
        ) : null}
      </section>

      {/* --------------------------------------------------------- stations */}
      <section className="section">
        <div className="section-head">
          <h2>Aid stations</h2>
        </div>

        {destinations && !destinations.length ? (
          <EmptyState
            glyph="⛺"
            title="No destinations yet"
            body="Add the aid stations on the event page first, then plan what each one feeds."
            action={
              <Link className="btn btn-primary" to={`/events/${event.id}`}>
                Back to the event
              </Link>
            }
          />
        ) : null}

        {(destinations ?? []).map((destination) => {
          const stationLines = (lines ?? []).filter(
            (line) => line.destinationId === destination.id,
          );
          const linked = raceSummary(destination);
          const through = stationRunners(destination, races ?? []);
          return (
            <div key={destination.id} className="card card-pad mb-3">
              <div className="spread mb-2">
                <span className="strong">
                  {DESTINATION_ICONS[destination.type]} {destination.name}
                </span>
                <Pill tone={through ? 'info' : 'default'}>{runnersLabel(destination)}</Pill>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm mb-2"
                onClick={() => setLinkingRaces(destination)}
              >
                {linked ? `Races: ${linked}` : '+ Which races come through?'}
              </button>

              <div className="list">
                {stationLines.map((line) => {
                  const item = itemById.get(line.itemId);
                  if (!item) return null;
                  const scope = line.raceId ? raceName(line.raceId) : null;
                  const parts = [
                    line.perRunner > 0
                      ? `${trimRatio(line.perRunner)} per ${scope ? `${scope} ` : ''}runner`
                      : null,
                    line.flatQty > 0 ? `${formatQty(line.flatQty, item.unit)} flat` : null,
                  ].filter(Boolean);
                  const byDay = lineQtyByDay(line, destination, races ?? []);
                  const total = byDay.reduce((sum, [, qty]) => sum + qty, 0);
                  return (
                    <button
                      key={line.id}
                      type="button"
                      className="row"
                      onClick={() => setEditingLine(line)}
                    >
                      <span className="row-body">
                        <span className="row-title">
                          {item.name}
                          {scope ? <span className="muted"> · {scope}</span> : null}
                        </span>
                        <span className="row-sub">{parts.join(' + ') || 'No rule yet — tap to set'}</span>
                      </span>
                      <span className="row-end">
                        <span className="strong">{formatQty(total, item.unit)}</span>
                        {hasDays && byDay.length ? (
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {splitLabel(byDay)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => setAddingItems(destination)}
              >
                + Add items
              </button>
            </div>
          );
        })}
      </section>

      {/* ----------------------------------------------------------- totals */}
      {totals.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Totals to order</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportOrder}>
              ⬇ CSV
            </button>
          </div>
          <div className="list">
            {totals.map((total) => (
              <div key={total.item.id} className="row row-static">
                <span className="row-body">
                  <span className="row-title">{total.item.name}</span>
                  <span className="row-sub">
                    needs {formatQty(total.total, total.item.unit)}
                    {hasDays && total.byDay.length > 1 ? ` (${splitLabel(total.byDay)})` : ''} ·{' '}
                    {formatQty(total.onHand, total.item.unit)} on hand
                  </span>
                </span>
                <span className="row-end">
                  {total.toOrder > 0 ? (
                    <Pill tone="warn">order {formatQty(total.toOrder, total.item.unit)}</Pill>
                  ) : (
                    <Pill tone="ok">covered</Pill>
                  )}
                </span>
              </div>
            ))}
          </div>
          {shortfalls.length ? (
            <p className="tiny muted mt-2">
              {plural(shortfalls.length, 'item')} short of the plan. The CSV is the list to take to
              the supplier{hasDays ? ', with a column per day' : ''}.
            </p>
          ) : null}
        </section>
      ) : null}

      {plannedStations ? (
        <div className="action-bar no-print">
          <button
            type="button"
            className="btn btn-primary"
            disabled={working}
            onClick={() => setApplying(true)}
          >
            Send quantities to packlists
          </button>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- sheets */}
      {addingRace ? (
        <RaceSheet event={event} existing={races ?? []} onClose={() => setAddingRace(false)} />
      ) : null}

      {removingRace ? (
        <ConfirmSheet
          title={`Remove the ${removingRace.name}?`}
          body="Stations linked to it fall back to their other races, and rules written for it alone go with it. Nothing on any packlist changes until quantities are sent again."
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemovingRace(undefined)}
          onConfirm={() => {
            const race = removingRace;
            setRemovingRace(undefined);
            void (async () => {
              await softDelete(db.races, race.id);
              // Take the race off every station pointing at it, so the links
              // read honestly rather than resting on the lookup ignoring them.
              for (const destination of destinations ?? []) {
                if (destination.raceVisits?.some((visit) => visit.raceId === race.id)) {
                  await update(db.destinations, destination.id, {
                    raceVisits: destination.raceVisits.filter((visit) => visit.raceId !== race.id),
                  });
                }
              }
              for (const line of (lines ?? []).filter((entry) => entry.raceId === race.id)) {
                await softDelete(db.consumptionLines, line.id);
              }
              toast('Race removed');
            })();
          }}
        />
      ) : null}

      {linkingRaces ? (
        <StationRacesSheet
          destination={linkingRaces}
          races={races ?? []}
          onClose={() => setLinkingRaces(undefined)}
        />
      ) : null}

      {addingItems ? (
        <ItemPicker
          title={`Add to ${addingItems.name}`}
          categoryId={seedId('cat', FOOD_CATEGORY.name)}
          exclude={(lines ?? [])
            .filter((line) => line.destinationId === addingItems.id)
            .map((line) => line.itemId)}
          onClose={() => setAddingItems(undefined)}
          onPick={(picks) => {
            const destination = addingItems;
            setAddingItems(undefined);
            void addPlanItems(
              event.id,
              destination.id,
              picks.map((pick) => ({ itemId: pick.item.id, qty: pick.qty })),
            ).then((added) => {
              toast(`${plural(added, 'item')} added — tap a line to set its per-runner rule`);
            });
          }}
        />
      ) : null}

      {editingLine ? (
        <LineSheet
          line={editingLine}
          itemName={itemById.get(editingLine.itemId)?.name ?? 'Item'}
          destination={(destinations ?? []).find((entry) => entry.id === editingLine.destinationId)}
          races={races ?? []}
          siblings={(lines ?? []).filter(
            (entry) =>
              entry.destinationId === editingLine.destinationId &&
              entry.itemId === editingLine.itemId,
          )}
          hasDays={hasDays}
          onClose={() => setEditingLine(undefined)}
        />
      ) : null}

      {applying ? (
        <ConfirmSheet
          title="Send quantities to packlists?"
          body={
            <>
              Each station&rsquo;s computed quantities become the required amounts on its packlist —
              a packlist is created where a station has none. Planned items are set to today&rsquo;s
              numbers{hasDays ? ', with the day split written into the line note' : ''}; anything
              added to a packlist by hand is left alone. Safe to run again after a projection changes.
            </>
          }
          confirmLabel={working ? 'Sending…' : 'Send'}
          onCancel={() => setApplying(false)}
          onConfirm={() => void apply()}
        />
      ) : null}
    </Screen>
  );
}

/** Show a ratio without float noise: 0.02247191011 reads as 0.022. */
function trimRatio(value: number): string {
  if (value >= 0.01) return String(Math.round(value * 1000) / 1000);
  return String(Math.round(value * 100000) / 100000);
}

/** Add a race distance, its projected field and the day it runs. */
function RaceSheet({
  event,
  existing,
  onClose,
}: {
  event: RaceEvent;
  existing: Race[];
  onClose: () => void;
}) {
  const toast = useToast();
  const dayOptions = eventDays(event);
  const [name, setName] = useState('');
  const [projection, setProjection] = useState(100);
  // A one-day event needs no asking; a weekend leaves it open until told.
  const [day, setDay] = useState(dayOptions.length === 1 ? dayOptions[0] : '');

  const save = async () => {
    if (!name.trim()) return;
    await create(db.races, {
      eventId: event.id,
      name: name.trim(),
      projection,
      sort: nextSort(existing),
      day: day || null,
    });
    toast('Race added');
    onClose();
  };

  return (
    <Sheet
      title="New race"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            Add
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Distance">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              value={name}
              placeholder="50k"
              onChange={(changed) => setName(changed.target.value)}
            />
          )}
        </Field>
        <Field label="Projected starters" hint="A projection is fine — it can move any time and the plan follows.">
          {(id) => (
            <span id={id}>
              <Stepper label="projected starters" value={projection} min={0} step={5} onChange={setProjection} />
            </span>
          )}
        </Field>
        {dayOptions.length > 1 ? (
          <Field label="Runs on" hint="Splits every station and the order list by day.">
            {(id) => (
              <select id={id} className="select" value={day} onChange={(changed) => setDay(changed.target.value)}>
                <option value="">Not set</option>
                {dayOptions.map((option) => (
                  <option key={option} value={option}>
                    {dayLabel(option)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Which races pass this station, and how many times. Passes rather than a
 * checkbox because an out-and-back course sends the same field through twice,
 * and each pass eats.
 */
function StationRacesSheet({
  destination,
  races,
  onClose,
}: {
  destination: Destination;
  races: Race[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [passes, setPasses] = useState<Record<string, number>>(() =>
    Object.fromEntries((destination.raceVisits ?? []).map((visit) => [visit.raceId, visit.passes])),
  );

  const visits: RaceVisit[] = races
    .filter((race) => (passes[race.id] ?? 0) > 0)
    .map((race) => ({ raceId: race.id, passes: passes[race.id] }));
  const estimate = races.reduce(
    (sum, race) => sum + race.projection * (passes[race.id] ?? 0),
    0,
  );

  const save = async () => {
    await update(db.destinations, destination.id, { raceVisits: visits });
    toast('Races updated');
    onClose();
  };

  return (
    <Sheet
      title={destination.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <p className="small muted mb-3">
        Set how many times each field comes through — 0 for races that never pass, 2 where the
        course doubles back.
      </p>
      <div className="list">
        {races.map((race) => (
          <div key={race.id} className="row row-static">
            <span className="row-body">
              <span className="row-title">{race.name}</span>
              <span className="row-sub">
                {race.projection} projected{race.day ? ` · ${dayLabel(race.day)}` : ''}
              </span>
            </span>
            <span className="row-end">
              <Stepper
                label={`${race.name} passes`}
                value={passes[race.id] ?? 0}
                min={0}
                max={9}
                onChange={(next) => setPasses((current) => ({ ...current, [race.id]: next }))}
              />
            </span>
          </div>
        ))}
        {!races.length ? (
          <div className="row row-static muted">Add the races first, up at the top.</div>
        ) : null}
      </div>
      <p className="small mt-3">
        <span className="strong">{estimate} runners</span> through this station.
      </p>
    </Sheet>
  );
}

/**
 * Edit one consumption rule: what it applies to, the per-runner ratio and the
 * flat amount — and add a sibling rule for another race, because the marathon
 * field and the 17k field do not drink the same amount of coke.
 */
function LineSheet({
  line,
  itemName,
  destination,
  races,
  siblings,
  hasDays,
  onClose,
}: {
  line: ConsumptionLine;
  itemName: string;
  destination: Destination | undefined;
  races: Race[];
  siblings: ConsumptionLine[];
  hasDays: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [raceId, setRaceId] = useState<string>(line.raceId ?? '');
  const [perRunner, setPerRunner] = useState(line.perRunner ? String(line.perRunner) : '');
  const [flatQty, setFlatQty] = useState(line.flatQty);
  const [removing, setRemoving] = useState(false);
  const [copyFor, setCopyFor] = useState('');

  const parsed = Number(perRunner);
  const ratio = perRunner.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const draft: ConsumptionLine = { ...line, perRunner: ratio, flatQty, raceId: raceId || null };
  const visits = destination ? stationVisits(destination, races) : [];
  const byDay = destination ? lineQtyByDay(draft, destination, races) : [];
  const preview = byDay.reduce((sum, [, qty]) => sum + qty, 0);
  // Races through this station that have no rule of their own for this item yet.
  const uncovered = visits
    .map((visit) => visit.race)
    .filter((race) => race.id !== (raceId || null) && !siblings.some((entry) => entry.raceId === race.id));

  const save = async () => {
    await update(db.consumptionLines, line.id, { perRunner: ratio, flatQty, raceId: raceId || null });
    toast('Rule saved');
    onClose();
  };

  return (
    <Sheet
      title={itemName}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={() => setRemoving(true)}>
            Remove
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        {visits.length ? (
          <Field
            label="Counts"
            hint="One rule for every race through the station, or one per race where the fields eat differently."
          >
            {(id) => (
              <select id={id} className="select" value={raceId} onChange={(changed) => setRaceId(changed.target.value)}>
                <option value="">Every race through here</option>
                {visits.map((visit) => (
                  <option key={visit.race.id} value={visit.race.id}>
                    {visit.race.name} only{visit.race.day ? ` · ${dayLabel(visit.race.day)}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field
          label="Per runner"
          hint="Units of this item per runner — 0.2 means one between five. Leave 0 for things that don't scale."
        >
          {(id) => (
            <input
              id={id}
              className="input"
              inputMode="decimal"
              value={perRunner}
              placeholder="0.2"
              onChange={(changed) => setPerRunner(changed.target.value)}
            />
          )}
        </Field>
        <Field label="Flat amount" hint="Supplied regardless of numbers — the salt shaker, the tea box.">
          {(id) => (
            <span id={id}>
              <Stepper label="flat amount" value={flatQty} min={0} onChange={setFlatQty} />
            </span>
          )}
        </Field>
        <p className="small">
          <span className="strong">{preview}</span> needed here
          {hasDays && byDay.length > 1
            ? ` — ${byDay.map(([day, qty]) => `${dayShort(day)} ${qty}`).join(', ')}`
            : ''}
          .
        </p>

        {uncovered.length ? (
          <div className="card card-pad">
            <p className="small strong">Another rule for a different race</p>
            <p className="tiny muted mb-2">
              Starts from this ratio, without the flat amount, so a shaker is not doubled.
            </p>
            <div className="row-flex">
              <select
                className="select grow"
                aria-label="Race for the new rule"
                value={copyFor}
                onChange={(changed) => setCopyFor(changed.target.value)}
              >
                <option value="">Pick a race…</option>
                {uncovered.map((race) => (
                  <option key={race.id} value={race.id}>
                    {race.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!copyFor}
                onClick={() => {
                  void copyRuleForRace(draft, copyFor).then(() => {
                    toast(`Rule added for the ${races.find((race) => race.id === copyFor)?.name ?? 'race'}`);
                    onClose();
                  });
                }}
              >
                Add
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {removing ? (
        <ConfirmSheet
          title={`Take ${itemName} off this station?`}
          body="Only the plan changes — nothing already on the packlist is removed."
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            void softDelete(db.consumptionLines, line.id).then(() => {
              toast('Removed from the plan');
              onClose();
            });
          }}
        />
      ) : null}
    </Sheet>
  );
}
