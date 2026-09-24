import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '../App';
import { ItemPicker } from '../components/ItemPicker';
import { EmptyState, Field, Pill } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useCategories, useDestinations, useEvents, useItems } from '../hooks/useDb';
import { interpretGrids } from '../domain/importGrid';
import type { Grid } from '../domain/importGrid';
import { fileKind, readSpreadsheet } from '../domain/spreadsheet';
import { buildPlan, commitImport } from '../domain/packlistImport';
import type { ImportPlan, ItemPlan, PlacePlan } from '../domain/packlistImport';
import { formatQty, plural } from '../domain/format';
import type { Item } from '../db/types';

/**
 * Import a pack list from a file.
 *
 * The crew's pack lists live in spreadsheets and PDF run sheets, and typing
 * sixty lines into a phone is how a feature goes unused. So the file is read
 * on the device, matched to the catalogue and the event's stations, and shown
 * back as a plan before anything is written: which heading is which station,
 * which name is which item, and what the warehouse has never heard of. The
 * matcher's guesses are marked as guesses. Nothing is written until the
 * button at the bottom, and then exactly what is on the screen is written.
 */

type Stage = 'pick' | 'review';

const CREATE = '__create__';
const SKIP = '__skip__';

export default function ImportPacklistScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const events = useEvents();
  const items = useItems();
  const categories = useCategories();

  // With no event named, the one most likely being packed right now. An event
  // named in the address that this account may not see is treated as none.
  const [chosenEventId, setEventId] = useState(params.get('event') ?? '');
  const eventId = useMemo(() => {
    if (!events?.length) return '';
    if (chosenEventId && events.some((event) => event.id === chosenEventId)) return chosenEventId;
    const open = events.filter((event) => event.status !== 'closed');
    return (open.find((event) => event.status === 'packing') ?? open[0] ?? events[0]).id;
  }, [chosenEventId, events]);
  const destinations = useDestinations(eventId || undefined);

  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState('');
  const [grids, setGrids] = useState<Grid[]>([]);
  const [useGrid, setUseGrid] = useState<ReadonlySet<string>>(new Set());
  const [plan, setPlan] = useState<ImportPlan>();
  const [existing, setExisting] = useState<'set' | 'add'>('set');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [rematching, setRematching] = useState<ItemPlan>();
  const fileInput = useRef<HTMLInputElement>(null);

  const event = events?.find((entry) => entry.id === eventId);

  /** Read the chosen sheets against the chosen event. */
  const rebuild = (sources: Grid[], chosen: ReadonlySet<string>) => {
    if (!eventId || !destinations || !items || !categories) return;
    const selected = sources.filter((grid) => chosen.has(grid.name));
    const parsed = interpretGrids(selected, {
      placeNames: destinations.map((destination) => destination.name),
      categoryNames: categories.map((category) => category.name),
    });
    setPlan(buildPlan(parsed, { eventId, destinations, items, categories }));
  };

  const load = async (file: File) => {
    setBusy(true);
    setProblem('');
    try {
      const kind = fileKind(file.name);
      let sources: Grid[];
      if (kind === 'pdf') {
        const { readPdf } = await import('../domain/pdfGrid');
        sources = await readPdf(await file.arrayBuffer());
      } else {
        sources = await readSpreadsheet(file);
      }
      const chosen = new Set(sources.map((grid) => grid.name));
      setFileName(file.name);
      setGrids(sources);
      setUseGrid(chosen);
      rebuild(sources, chosen);
      setStage('review');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const toggleGrid = (name: string) => {
    const next = new Set(useGrid);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setUseGrid(next);
    rebuild(grids, next);
  };

  const updatePlace = (heading: string, changes: Partial<PlacePlan>) =>
    setPlan((current) =>
      current && {
        ...current,
        places: current.places.map((place) => (place.heading === heading ? { ...place, ...changes } : place)),
      },
    );

  const updateItem = (key: string, changes: Partial<ItemPlan>) =>
    setPlan((current) =>
      current && {
        ...current,
        items: current.items.map((item) => (item.key === key ? { ...item, ...changes } : item)),
      },
    );

  const commit = async () => {
    if (!plan || !event) return;
    setBusy(true);
    try {
      const result = await commitImport(plan, { existing, source: fileName });
      const parts = [
        `${plural(result.linesAdded, 'line')} added`,
        result.linesUpdated ? `${result.linesUpdated} updated` : '',
        result.itemsCreated ? `${plural(result.itemsCreated, 'new item')}` : '',
        result.destinationsCreated ? `${plural(result.destinationsCreated, 'new destination')}` : '',
      ].filter(Boolean);
      toast(`Imported · ${parts.join(', ')}`);
      navigate(`/events/${event.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The import failed', 'error');
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------- derived -- */

  const itemById = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  const destinationName = (id: string | null) =>
    destinations?.find((destination) => destination.id === id)?.name ?? 'Unknown station';

  /** Which destination each heading will land on, for the per-line summary. */
  const placeLabel = (heading: string | null): string => {
    if (heading === null) return plan?.unplacedDestinationId ? destinationName(plan.unplacedDestinationId) : 'No station';
    const place = plan?.places.find((entry) => entry.heading === heading);
    if (!place || place.action === 'skip') return `${heading} (skipped)`;
    if (place.action === 'create') return heading;
    return destinationName(place.destinationId);
  };

  const needsLook = (item: ItemPlan) => item.action === 'create' || item.confidence !== 'sure';
  const toCheck = plan?.items.filter((item) => item.action !== 'skip' && needsLook(item)) ?? [];
  const matched = plan?.items.filter((item) => item.action !== 'skip' && !needsLook(item)) ?? [];
  const skipped = plan?.items.filter((item) => item.action === 'skip') ?? [];

  const going = plan
    ? plan.places.filter((place) => place.action !== 'skip').length +
      (plan.unplacedLines && plan.unplacedDestinationId ? 1 : 0)
    : 0;
  const creating = plan?.items.filter((item) => item.action === 'create').length ?? 0;
  const nothingToImport = !plan || !plan.items.some((item) => item.action !== 'skip') || going === 0;

  /* -------------------------------------------------------------- render -- */

  if (stage === 'pick') {
    return (
      <Screen title="Import a pack list" back={eventId ? `/events/${eventId}` : '/events'}>
        <div className="stack">
          <Field label="Event" hint="Every line lands on this event's packlists.">
            {(id) => (
              <select id={id} className="select" value={eventId} onChange={(entry) => setEventId(entry.target.value)}>
                {!events?.length ? <option value="">No events yet</option> : null}
                {(events ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="card card-pad">
            <p className="small">
              Choose an Excel workbook, a CSV or a PDF run sheet. Stations across the top, one block per
              station, or a plain list all work. Names are matched to the catalogue and anything the
              warehouse has never heard of is offered as a new item, and you check the lot before it is
              written.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block mt-3"
              disabled={!eventId || busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? 'Reading…' : '📄 Choose a file'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,.csv,.tsv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(entry) => {
                const file = entry.target.files?.[0];
                if (file) void load(file);
                entry.target.value = '';
              }}
            />
            {problem ? (
              <p className="small mt-3" style={{ color: 'var(--danger)' }}>
                {problem}
              </p>
            ) : null}
          </div>

          {events && !events.length ? (
            <EmptyState glyph="🏃" title="No events to import onto" body="Add the event first, then bring its pack list in." />
          ) : null}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Check the import"
      subtitle={event ? `${fileName} → ${event.name}` : fileName}
      back="-1"
      actions={
        <button
          type="button"
          className="header-btn"
          aria-label="Choose a different file"
          onClick={() => {
            setStage('pick');
            setPlan(undefined);
          }}
        >
          ✕
        </button>
      }
    >
      {plan ? (
        <>
          <div className="card card-pad mb-3">
            <div className="spread">
              <span className="strong">
                {plural(plan.items.length, 'item')}
                {plan.places.length ? ` across ${plural(plan.places.length, 'heading')}` : ''}
              </span>
              {toCheck.length ? <Pill tone="warn">{toCheck.length} to check</Pill> : <Pill tone="ok">All matched</Pill>}
            </div>
            <p className="tiny muted mt-2">
              {creating ? `${plural(creating, 'item')} will be created in the catalogue. ` : ''}
              {plan.skippedRows ? `${plural(plan.skippedRows, 'row')} had no quantity and were passed over. ` : ''}
              Every item lands on a station once: repeats in the file are added together.
            </p>
            {grids.length > 1 ? (
              <div className="mt-3">
                <span className="tiny muted">Read from</span>
                <div className="chip-row mt-2" role="group">
                  {grids.map((grid) => (
                    <button
                      key={grid.name}
                      type="button"
                      className="chip"
                      aria-pressed={useGrid.has(grid.name)}
                      onClick={() => toggleGrid(grid.name)}
                    >
                      {grid.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {plan.places.length || plan.unplacedLines ? (
            <section className="section">
              <div className="section-head">
                <h2>Where it goes</h2>
              </div>
              <div className="list">
                {plan.places.map((place) => (
                  <div key={place.heading} className="row row-static" style={{ flexWrap: 'wrap' }}>
                    <span className="row-body">
                      <span className="row-title">
                        {place.heading}
                        {place.guessed && place.action === 'existing' ? <Pill tone="info"> guessed</Pill> : null}
                      </span>
                      <span className="row-sub">{plural(place.lines, 'line')} in the file</span>
                    </span>
                    <select
                      className="select"
                      style={{ flexBasis: '100%' }}
                      aria-label={`Station for ${place.heading}`}
                      value={place.action === 'existing' ? (place.destinationId ?? SKIP) : place.action === 'create' ? CREATE : SKIP}
                      onChange={(entry) => {
                        const value = entry.target.value;
                        if (value === CREATE) updatePlace(place.heading, { action: 'create', destinationId: null, guessed: false });
                        else if (value === SKIP) updatePlace(place.heading, { action: 'skip', destinationId: null, guessed: false });
                        else updatePlace(place.heading, { action: 'existing', destinationId: value, guessed: false });
                      }}
                    >
                      <option value={SKIP}>Skip this heading</option>
                      {(destinations ?? []).map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.name}
                        </option>
                      ))}
                      <option value={CREATE}>Create “{place.heading}” as a new destination</option>
                    </select>
                  </div>
                ))}
                {plan.unplacedLines ? (
                  <div className="row row-static" style={{ flexWrap: 'wrap' }}>
                    <span className="row-body">
                      <span className="row-title">Lines with no station named</span>
                      <span className="row-sub">{plural(plan.unplacedLines, 'line')} in the file</span>
                    </span>
                    <select
                      className="select"
                      style={{ flexBasis: '100%' }}
                      aria-label="Station for lines with no station named"
                      value={plan.unplacedDestinationId ?? SKIP}
                      onChange={(entry) =>
                        setPlan({ ...plan, unplacedDestinationId: entry.target.value === SKIP ? null : entry.target.value })
                      }
                    >
                      <option value={SKIP}>Skip them</option>
                      {(destinations ?? []).map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {toCheck.length ? (
            <section className="section">
              <div className="section-head">
                <h2>Needs a look</h2>
                <span className="small muted">{toCheck.length}</span>
              </div>
              <div className="list">
                {toCheck.map((item) => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    match={item.itemId ? itemById.get(item.itemId) : undefined}
                    categories={categories ?? []}
                    placeLabel={placeLabel}
                    onChange={(changes) => updateItem(item.key, changes)}
                    onRematch={() => setRematching(item)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {matched.length ? (
            <section className="section">
              <div className="section-head">
                <h2>Matched</h2>
                <span className="small muted">{matched.length}</span>
              </div>
              <div className="list">
                {matched.map((item) => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    match={item.itemId ? itemById.get(item.itemId) : undefined}
                    categories={categories ?? []}
                    placeLabel={placeLabel}
                    onChange={(changes) => updateItem(item.key, changes)}
                    onRematch={() => setRematching(item)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {skipped.length ? (
            <section className="section">
              <div className="section-head">
                <h2>Skipped</h2>
                <span className="small muted">{skipped.length}</span>
              </div>
              <div className="list">
                {skipped.map((item) => (
                  <div key={item.key} className="row row-static">
                    <span className="row-body">
                      <span className="row-title muted">{item.name}</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => updateItem(item.key, { action: item.itemId ? 'existing' : 'create' })}
                    >
                      Put back
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {!plan.items.length ? (
            <EmptyState
              glyph="🤷"
              title="Nothing to import"
              body="No rows with an item and a quantity were found. If it is a scanned PDF, the text cannot be read; try the spreadsheet it was printed from."
            />
          ) : null}

          <section className="section">
            <div className="section-head">
              <h2>Already on a packlist</h2>
            </div>
            <div className="card card-pad stack-sm">
              <label className="checkbox">
                <input type="radio" name="existing" checked={existing === 'set'} onChange={() => setExisting('set')} />
                <span>
                  Set the quantity to the file's
                  <span className="small muted" style={{ display: 'block' }}>
                    Importing the same file twice changes nothing.
                  </span>
                </span>
              </label>
              <label className="checkbox">
                <input type="radio" name="existing" checked={existing === 'add'} onChange={() => setExisting('add')} />
                <span>
                  Add the file's quantity to what is listed
                  <span className="small muted" style={{ display: 'block' }}>
                    For a file of extras on top of a list already built.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <div className="action-bar">
            <button type="button" className="btn btn-primary btn-lg" disabled={busy || nothingToImport} onClick={() => void commit()}>
              {busy ? 'Importing…' : `Import to ${event?.name ?? 'event'}`}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">Reading…</p>
      )}

      {rematching ? (
        <ItemPicker
          title={`Which item is “${rematching.name}”?`}
          onClose={() => setRematching(undefined)}
          onPick={(picks) => {
            const pick = picks[0];
            if (pick) {
              updateItem(rematching.key, {
                action: 'existing',
                itemId: pick.item.id,
                confidence: 'sure',
                score: 1,
              });
            }
            setRematching(undefined);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** One item the file wants: what it will become, where it goes, and how to change that. */
function ItemRow({
  item,
  match,
  categories,
  placeLabel,
  onChange,
  onRematch,
}: {
  item: ItemPlan;
  match: Item | undefined;
  categories: Array<{ id: string; name: string }>;
  placeLabel: (heading: string | null) => string;
  onChange: (changes: Partial<ItemPlan>) => void;
  onRematch: () => void;
}) {
  const unit = match?.unit ?? 'each';
  const where = item.quantities.map((entry) => `${placeLabel(entry.place)} ${formatQty(entry.qty, unit)}`).join(' · ');

  return (
    <div className="row row-static" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span className="row-body">
        <span className="row-title">
          {item.name}
          {item.action === 'create' ? (
            <Pill tone="accent"> new item</Pill>
          ) : item.confidence === 'likely' ? (
            <Pill tone="warn"> guessed</Pill>
          ) : null}
        </span>
        {item.alsoWritten.length ? (
          <span className="row-sub">Also written as {item.alsoWritten.join(', ')}</span>
        ) : null}
        {item.action === 'existing' && match ? (
          <span className="row-sub">
            → {match.name}
            {match.sku ? ` · ${match.sku}` : ''}
          </span>
        ) : null}
        <span className="row-sub">{where}</span>
        {item.notes.length ? <span className="row-sub">📝 {item.notes.join(' · ')}</span> : null}
      </span>
      <div className="btn-row" style={{ flexBasis: '100%' }}>
        {item.action === 'create' ? (
          <select
            className="select"
            aria-label={`Category for ${item.name}`}
            value={item.categoryId ?? ''}
            onChange={(entry) => onChange({ categoryId: entry.target.value || null })}
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn btn-outline btn-sm" onClick={onRematch}>
          {item.action === 'create' ? 'Match' : 'Change'}
        </button>
        {item.action === 'existing' ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => onChange({ action: 'create', itemId: null, confidence: 'none', score: 0 })}
          >
            Make new
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ action: 'skip' })}>
          Skip
        </button>
      </div>
    </div>
  );
}
