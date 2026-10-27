import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../App';
import { ConfirmSheet, EmptyState, Field, Pill, Sheet, Stepper } from '../components/ui';
import { ItemPicker } from '../components/ItemPicker';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { byId, create, nextSort, restore, softDelete, update } from '../db/repo';
import { FOOD_CATEGORY } from '../db/foodCatalogue';
import { seedId } from '../db/seed';
import {
  useConsumptionLines,
  useCrewName,
  useDestinations,
  useEvent,
  useItems,
  useRaces,
} from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import {
  applyPlanToPacklists,
  addPlanItems,
  copyRuleForRace,
  copyRulesToStations,
  dayLabel,
  dayShort,
  eventDays,
  lineQtyByDay,
  parseAmount,
  planCopyToStations,
  sortDays,
  stationRunners,
  stationRunnersByDay,
  stationVisits,
  suggestedPerRunner,
  totalsToOrder,
} from '../domain/consumption';
import type { CopyPlan } from '../domain/consumption';
import { downloadCsv, slugify } from '../domain/backup';
import { addShortfalls } from '../domain/shopping';
import { DESTINATION_ICONS, formatQty, plural } from '../domain/format';
import type { ConsumptionLine, Destination, Item, Race, RaceEvent, RaceVisit } from '../db/types';

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
  const navigate = useNavigate();
  const toast = useToast();
  const crew = useCrewName();
  const { session } = useSession();
  const event = useEvent(eventId);
  const destinations = useDestinations(eventId);
  const races = useRaces(eventId);
  const lines = useConsumptionLines(eventId);
  const items = useItems();

  const [addingRace, setAddingRace] = useState(false);
  const [renamingRace, setRenamingRace] = useState<Race>();
  const [removingRace, setRemovingRace] = useState<Race>();
  const [linkingRaces, setLinkingRaces] = useState<Destination>();
  const [addingItems, setAddingItems] = useState<Destination>();
  // Picked items waiting for their amounts, before anything is written.
  const [amountsFor, setAmountsFor] = useState<{ destination: Destination; items: Item[] }>();
  const [copying, setCopying] = useState<{ destination: Destination; plan: CopyPlan }>();
  const [editingLine, setEditingLine] = useState<ConsumptionLine>();
  const [applying, setApplying] = useState(false);
  const [working, setWorking] = useState(false);
  // Set before the first await, so a second tap in the same frame (before
  // `working` has re-rendered the button) is turned away too.
  const sending = useRef(false);
  const [listing, setListing] = useState(false);

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
    if (!hasDays) return `${stationRunners(destination, races ?? [])} runners through`;
    const byDay = stationRunnersByDay(destination, races ?? []);
    if (!byDay.length) return 'No runners through yet';
    // "Sun: 400 runners", not "Sun 400": a bare number by a day read as a code.
    return byDay.map(([day, runners]) => `${dayShort(day)}: ${runners} runners`).join(' · ');
  };

  const splitLabel = (byDay: Array<[string | null, number]>) =>
    byDay.map(([day, qty]) => `${dayShort(day)}: ${qty}`).join(' · ');

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
    if (sending.current) return;
    sending.current = true;
    setWorking(true);
    let result;
    try {
      result = await applyPlanToPacklists(event.id, destinations ?? []);
    } finally {
      sending.current = false;
      setWorking(false);
    }
    setApplying(false);
    if (!result.stations) {
      toast('Nothing to add yet: the plan works out to zero', 'warn');
      return;
    }
    toast(
      `${plural(result.stations, 'packing list')} updated` +
        (result.created ? `, ${result.created} new` : ''),
    );
  };

  const dayOptions = eventDays(event);
  const canShop = can(session, 'shopping:manage', { eventId: event.id });

  /**
   * Send the shortfalls to the shopping list, tagged with this event. Safe to
   * tap again after a projection moves: the plan's lines are set to today's
   * figures rather than topped up. Then go to the list, because in testing
   * people tapped this and were left wondering where the items had gone.
   */
  const toShoppingList = async () => {
    setListing(true);
    let result;
    try {
      result = await addShortfalls(event.id, totals, crew);
    } finally {
      setListing(false);
    }
    const changed = result.added + result.updated;
    toast(
      changed
        ? `${plural(changed, 'item')} on the shopping list${result.added ? ` · ${result.added} new` : ''}`
        : 'The shopping list already has these figures',
      changed ? 'ok' : 'warn',
    );
    navigate('/shopping');
  };

  /** Work out the copy first, so the confirm can say how many it adds where. */
  const askToCopy = (destination: Destination) => {
    const plan = planCopyToStations(destination, destinations ?? [], lines ?? [], races ?? []);
    if (!plan.rules.length) {
      toast(
        'Nothing to copy: every other aid station with races already has these items, or has no races yet',
        'warn',
      );
      return;
    }
    setCopying({ destination, plan });
  };

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
            body="Add each distance and how many runners you expect. Every aid station amount is worked out from these numbers."
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
                  <span className="row-sub">expected runners</span>
                )}
              </span>
              <span className="row-end">
                <Stepper
                  label={`${race.name} expected runners`}
                  value={race.projection}
                  min={0}
                  step={5}
                  onChange={(next) => void update(db.races, race.id, { projection: next })}
                />
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Rename ${race.name}`}
                onClick={() => setRenamingRace(race)}
              >
                ✎
              </button>
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
              <span className="row-end strong">{projected} expected runners</span>
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
            title="No stations yet"
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
                    line.flatQty > 0 ? `fixed amount ${formatQty(line.flatQty, item.unit)}` : null,
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
                        <span className="row-sub">{parts.join(' + ') || 'No amount yet. Tap to set one'}</span>
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

              <div className="btn-row mt-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAddingItems(destination)}
                >
                  + Add items
                </button>
                {stationLines.length && destination.type === 'aid_station' ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => askToCopy(destination)}
                  >
                    ⧉ Copy to all stations
                  </button>
                ) : null}
              </div>
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
            <>
              {canShop ? (
                <div className="btn-row mt-3 no-print">
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={listing}
                    onClick={() => void toShoppingList()}
                  >
                    🛒 Put {plural(shortfalls.length, 'shortfall')} on the shopping list
                  </button>
                </div>
              ) : null}
              <p className="tiny muted mt-2">
                {plural(shortfalls.length, 'item')} short of the plan. The shopping list is where the
                supplier run is worked; the CSV is the same figures as a file{hasDays ? ', with a column per day' : ''}.
              </p>
            </>
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
            Add the food to each station&rsquo;s packing list
          </button>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- sheets */}
      {addingRace ? (
        <RaceSheet event={event} existing={races ?? []} onClose={() => setAddingRace(false)} />
      ) : null}

      {renamingRace ? (
        <RaceSheet
          event={event}
          existing={races ?? []}
          race={renamingRace}
          onClose={() => setRenamingRace(undefined)}
        />
      ) : null}

      {removingRace ? (
        <ConfirmSheet
          title={`Remove the ${removingRace.name}?`}
          body="Stations linked to it fall back to their other races, and amounts set for it alone go with it. Nothing on any packing list changes until the food is added to them again."
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
            // The picker's numbers are only "picked"; the amount is asked for
            // next, per runner, where a number means something.
            setAmountsFor({ destination: addingItems, items: picks.map((pick) => pick.item) });
            setAddingItems(undefined);
          }}
        />
      ) : null}

      {amountsFor ? (
        <AmountsSheet
          destination={amountsFor.destination}
          items={amountsFor.items}
          runners={stationRunners(amountsFor.destination, races ?? [])}
          onClose={() => setAmountsFor(undefined)}
          onSave={(picks) => {
            const destination = amountsFor.destination;
            setAmountsFor(undefined);
            void addPlanItems(event.id, destination.id, picks).then((added) => {
              toast(`${plural(added, 'item')} added to ${destination.name}`);
            });
          }}
        />
      ) : null}

      {copying ? (
        <ConfirmSheet
          title={`Copy to ${plural(copying.plan.stations.length, 'station')}?`}
          body={
            <>
              {plural(copying.plan.rules.length, 'food amount')} from {copying.destination.name} go to{' '}
              {copying.plan.stations.map((station) => station.name).join(', ')}. Stations that already have an
              item keep their own amount for it. Only aid stations with races through them are included.
            </>
          }
          confirmLabel="Copy"
          onCancel={() => setCopying(undefined)}
          onConfirm={() => {
            const source = copying.destination;
            setCopying(undefined);
            void copyRulesToStations(source).then((result) =>
              toast(
                result.rules
                  ? `${plural(result.rules, 'food amount')} copied to ${plural(result.stations, 'station')}`
                  : 'Nothing new to copy',
                result.rules ? 'ok' : 'warn',
              ),
            );
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
          title="Add the food to each station's packing list?"
          body={
            <>
              Each station&rsquo;s food amounts become what its packing list needs. A station with no
              packing list gets one. Food items are set to today&rsquo;s numbers
              {hasDays ? ', with the split by day written in the item note' : ''}. Anything added to a
              packing list by hand is left alone. Safe to do again after the expected runners change.
            </>
          }
          confirmLabel={working ? 'Adding…' : 'Add'}
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

/**
 * Add a race distance, its expected runners and the day it runs, or change
 * them on one already there. Renaming in place keeps every station's link and
 * every amount set for the race, which deleting and adding it again lost.
 */
function RaceSheet({
  event,
  existing,
  race,
  onClose,
}: {
  event: RaceEvent;
  existing: Race[];
  race?: Race;
  onClose: () => void;
}) {
  const toast = useToast();
  const dayOptions = eventDays(event);
  const [name, setName] = useState(race?.name ?? '');
  const [projection, setProjection] = useState(race?.projection ?? 100);
  // A one-day event needs no asking; a weekend leaves it open until told.
  const [day, setDay] = useState(race ? (race.day ?? '') : dayOptions.length === 1 ? dayOptions[0] : '');
  // One race per tap on Add, however fast the second tap comes.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      if (race) {
        await update(db.races, race.id, { name: name.trim(), projection, day: day || null });
      } else {
        await create(db.races, {
          eventId: event.id,
          name: name.trim(),
          projection,
          sort: nextSort(existing),
          day: day || null,
        });
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
    toast(race ? 'Race saved' : 'Race added');
    onClose();
  };

  return (
    <Sheet
      title={race ? `Change ${race.name}` : 'New race'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || busy}
            onClick={() => void save()}
          >
            {race ? 'Save' : 'Add'}
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
        <Field label="Expected runners" hint="A best guess is fine. Change it any time and the plan follows.">
          {(id) => (
            <span id={id}>
              <Stepper label="expected runners" value={projection} min={0} step={5} onChange={setProjection} />
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

/** How one picked item's amount is being given. */
type AmountKind = 'perRunner' | 'fixed';

/**
 * How much of each picked item the station needs, asked straight after
 * picking.
 *
 * Per runner first, because that is what makes the plan follow the field:
 * in testing, items added as a bare number stayed at that number, and a
 * station planned for 400 runners got one can of Coke. Common items open on
 * a suggested amount to correct rather than a blank box. A fixed amount is
 * the second choice, for the things that do not change with runners.
 */
function AmountsSheet({
  destination,
  items,
  runners,
  onClose,
  onSave,
}: {
  destination: Destination;
  items: Item[];
  runners: number;
  onClose: () => void;
  onSave: (picks: Array<{ itemId: string; perRunner?: number; qty?: number }>) => void;
}) {
  const [kinds, setKinds] = useState<Record<string, AmountKind>>({});
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => {
        const suggestion = suggestedPerRunner(item);
        return [item.id, suggestion === null ? '' : String(suggestion)];
      }),
    ),
  );

  const kindOf = (item: Item): AmountKind => kinds[item.id] ?? 'perRunner';
  const parsedOf = (item: Item) => parseAmount(values[item.id] ?? '');
  const problems = items.filter((item) => 'error' in parsedOf(item));

  const save = () => {
    if (problems.length) return;
    onSave(
      items.map((item) => {
        const parsed = parsedOf(item);
        const value = 'value' in parsed ? (parsed.value ?? 0) : 0;
        return kindOf(item) === 'perRunner' ? { itemId: item.id, perRunner: value } : { itemId: item.id, qty: value };
      }),
    );
  };

  return (
    <Sheet
      title={`How much at ${destination.name}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={Boolean(problems.length)} onClick={save}>
            Add {plural(items.length, 'item')}
          </button>
        </>
      }
    >
      <p className="small muted mb-2">
        {runners
          ? `${runners} expected runners come through here. `
          : 'No races are linked to this station yet, so per-runner amounts work out to nothing until they are. '}
        Suggested amounts are starting points: change them to what your last event used.
      </p>
      {items.map((item) => {
        const kind = kindOf(item);
        const parsed = parsedOf(item);
        const value = 'value' in parsed ? (parsed.value ?? 0) : 0;
        const suggestion = suggestedPerRunner(item);
        const preview = kind === 'perRunner' ? Math.ceil(Math.round(value * runners * 100) / 100) : value;
        const inputId = `amount-${item.id}`;
        return (
          <div key={item.id} className="plan-amount-row">
            <label className="strong" htmlFor={inputId}>
              {item.name}
            </label>
            <div className="chip-row-inline">
              <button
                type="button"
                className="chip"
                aria-pressed={kind === 'perRunner'}
                onClick={() => setKinds((current) => ({ ...current, [item.id]: 'perRunner' }))}
              >
                Per runner
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={kind === 'fixed'}
                onClick={() => setKinds((current) => ({ ...current, [item.id]: 'fixed' }))}
              >
                Fixed amount
              </button>
            </div>
            <input
              id={inputId}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={values[item.id] ?? ''}
              placeholder={kind === 'perRunner' ? '0.2' : '1'}
              aria-invalid={'error' in parsed ? true : undefined}
              onChange={(changed) => setValues((current) => ({ ...current, [item.id]: changed.target.value }))}
            />
            {'error' in parsed ? (
              <span className="small" style={{ color: 'var(--danger)' }}>
                {parsed.error}. Use a number like 0.2 or 1,5.
              </span>
            ) : (
              <span className="tiny muted">
                {kind === 'perRunner'
                  ? `${formatQty(preview, item.unit)} for ${runners} runners${
                      suggestion !== null && String(suggestion) === (values[item.id] ?? '').trim()
                        ? '. Suggested, check it'
                        : ''
                    }`
                  : `${formatQty(preview, item.unit)} whatever the runners`}
              </span>
            )}
          </div>
        );
      })}
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
                {race.projection} expected runners{race.day ? ` · ${dayLabel(race.day)}` : ''}
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
  const [flat, setFlat] = useState(line.flatQty);
  const [flatTouched, setFlatTouched] = useState(false);
  const [copyFor, setCopyFor] = useState('');

  const parsed = parseAmount(perRunner);
  const ratioError = 'error' in parsed ? parsed.error : undefined;
  const ratio = 'value' in parsed ? (parsed.value ?? 0) : 0;
  // The picker's 1 becomes the flat amount on a new line. Once a per-runner
  // amount goes on, that 1 would ride on top unseen, so it drops to 0 unless
  // someone sets the flat amount on purpose.
  const flatQty = !flatTouched && line.perRunner === 0 && ratio > 0 ? 0 : flat;
  const setFlatQty = (next: number) => {
    setFlatTouched(true);
    setFlat(next);
  };
  const draft: ConsumptionLine = { ...line, perRunner: ratio, flatQty, raceId: raceId || null };
  const visits = destination ? stationVisits(destination, races) : [];
  const byDay = destination ? lineQtyByDay(draft, destination, races) : [];
  const preview = byDay.reduce((sum, [, qty]) => sum + qty, 0);
  // Races through this station that have no rule of their own for this item yet.
  const uncovered = visits
    .map((visit) => visit.race)
    .filter((race) => race.id !== (raceId || null) && !siblings.some((entry) => entry.raceId === race.id));

  const save = async () => {
    if (ratioError) return;
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
          <button
            type="button"
            className="btn btn-outline"
            onClick={() =>
              void softDelete(db.consumptionLines, line.id).then(() => {
                toast('Removed from the plan', 'ok', { undo: () => restore(db.consumptionLines, line.id) });
                onClose();
              })
            }
          >
            Remove
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(ratioError)}
            onClick={() => void save()}
          >
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
          hint="How much one runner takes: 0.2 means one between five. Leave it blank for things that don't change with runners."
        >
          {(id) => (
            <input
              id={id}
              className="input"
              inputMode="decimal"
              value={perRunner}
              placeholder="0.2"
              aria-invalid={ratioError ? true : undefined}
              onChange={(changed) => setPerRunner(changed.target.value)}
            />
          )}
        </Field>
        {ratioError ? (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {ratioError}. Use a number like 0.2 or 1,5.
          </p>
        ) : null}
        <Field label="Fixed amount" hint="The same however many runners come: the salt shaker, the tea box.">
          {(id) => (
            <span id={id}>
              <Stepper label="fixed amount" value={flatQty} min={0} onChange={setFlatQty} />
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
              Starts from this per-runner amount, without the fixed amount, so a shaker is not doubled.
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
                disabled={!copyFor || Boolean(ratioError)}
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

    </Sheet>
  );
}
