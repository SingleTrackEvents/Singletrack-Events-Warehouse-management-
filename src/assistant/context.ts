import { db } from '../db/db';
import { alive, byId, liveWhere } from '../db/repo';
import { lineTotal, stationVisits } from '../domain/consumption';
import { ACCESS_LABELS, DESTINATION_LABELS, formatQty } from '../domain/format';
import { primaryPacklist, statusIndex } from '../domain/packlists';
import { notesFor } from './notes';
import type {
  AssistantNote,
  Category,
  ConsumptionLine,
  Destination,
  Item,
  Packlist,
  PacklistLine,
  Race,
  RaceEvent,
  Template,
  TemplateLine,
} from '../db/types';
import type { CheckRequest } from './protocol';

/**
 * What the assistant gets to read before it says anything.
 *
 * Everything here is assembled on the device from the same local database the
 * screens use, then sent as plain text. The assistant is only as useful as
 * what it is shown, so this leans towards showing it the things an
 * experienced crew member would have in their head: what this kind of station
 * normally gets, what this exact station went out with last time, what the
 * food plan says it will eat, and the rules the admin has written down.
 *
 * Each section is rendered by a small pure function so the wording can be
 * tested without a database.
 */

/** How many earlier lists and sibling stations to show. Enough to see a pattern; not the whole season. */
const HISTORY_LIMIT = 3;
const SIBLING_LIMIT = 4;

/* -------------------------------------------------------------- catalogue -- */

/**
 * The catalogue, one line per item.
 *
 * Codes are what the assistant hands back to name an item, so every line
 * leads with one. Kits list what is inside, because "the aid station kit"
 * already covers thirty things a list would otherwise look short of.
 */
export function renderCatalogue(items: Item[], categories: Category[]): string {
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const itemById = byId(items);
  const live = items
    .filter((item) => !item.deletedAt && !item.archived)
    .sort(
      (a, b) =>
        (categoryName.get(a.categoryId ?? '') ?? '').localeCompare(categoryName.get(b.categoryId ?? '') ?? '') ||
        a.name.localeCompare(b.name),
    );

  const lines = live.map((item) => {
    const parts = [
      item.sku,
      item.name,
      categoryName.get(item.categoryId ?? '') ?? 'Uncategorised',
      unitLabel(item),
      item.consumable ? 'consumable' : 'asset',
    ];
    if (item.contents?.length) {
      const inside = item.contents
        .map((content) => {
          const child = itemById.get(content.itemId);
          return child ? `${content.qty} ${child.name}` : null;
        })
        .filter(Boolean)
        .join(', ');
      if (inside) parts.push(`kit containing: ${inside}`);
    }
    if (item.notes.trim()) parts.push(`note: ${item.notes.trim()}`);
    return parts.join(' | ');
  });

  return ['Format: code | name | category | unit | consumable or asset | extras', ...lines].join('\n');
}

function unitLabel(item: Item): string {
  if (item.packSize > 1) return `${item.unit} of ${item.packSize}`;
  return item.unit;
}

/* ---------------------------------------------------------------- station -- */

export interface StationContext {
  event: RaceEvent;
  destination: Destination;
  races: Race[];
}

export function renderStation({ event, destination, races }: StationContext): string {
  const lines = [
    `Event: ${event.name} (${event.location}), ${event.startDate}${event.endDate !== event.startDate ? ` to ${event.endDate}` : ''}, status ${event.status}.`,
    `Destination: ${destination.name}, ${withArticle(DESTINATION_LABELS[destination.type].toLowerCase())}${
      destination.courseKm !== null ? ` at ${destination.courseKm} km` : ''
    }.`,
    `Access: ${ACCESS_LABELS[destination.access]}${destination.accessNotes.trim() ? `. ${destination.accessNotes.trim()}` : '.'}`,
  ];
  if (destination.openTime || destination.closeTime) {
    lines.push(`Open ${destination.openTime || '?'} to ${destination.closeTime || '?'}.`);
  }
  if (destination.crewLead.trim()) lines.push(`Crew lead: ${destination.crewLead.trim()}.`);

  const visits = stationVisits(destination, races);
  if (visits.length) {
    const total = visits.reduce((sum, visit) => sum + visit.runners, 0);
    lines.push(
      `Races through here: ${visits
        .map(
          (visit) =>
            `${visit.race.name} (${visit.race.projection} runners${visit.passes > 1 ? `, ${visit.passes} passes` : ''}${
              visit.day ? `, ${visit.day}` : ''
            })`,
        )
        .join('; ')}. About ${total} runner passes in total.`,
    );
  } else {
    lines.push('No races are linked to this destination in the food plan.');
  }
  if (event.notes.trim()) lines.push(`Event notes: ${event.notes.trim()}`);
  if (destination.notes.trim()) lines.push(`Destination notes: ${destination.notes.trim()}`);
  return lines.join('\n');
}

/** "an aid station", "a finish line". */
function withArticle(noun: string): string {
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
}

/* --------------------------------------------------------------- packlist -- */

export function renderPacklist(packlist: Packlist, lines: PacklistLine[], items: Map<string, Item>): string {
  const live = lines.filter((line) => !line.deletedAt);
  const head = `List "${packlist.name}" (${packlist.code}), status ${packlist.status}, ${live.length} lines.${
    packlist.notes.trim() ? ` Notes: ${packlist.notes.trim()}` : ''
  }`;
  if (!live.length) return `${head}\nThe list is empty.`;
  const body = live.map((line) => {
    const item = items.get(line.itemId);
    const parts = [
      item?.sku ?? '?',
      item?.name ?? 'Unknown item',
      `required ${item ? formatQty(line.qtyRequired, item.unit) : line.qtyRequired}`,
    ];
    if (line.qtyPacked) parts.push(`packed ${line.qtyPacked}`);
    if (line.mandatory) parts.push('must-have');
    if (line.note.trim()) parts.push(`note: ${line.note.trim()}`);
    return parts.join(' | ');
  });
  return [head, 'Format: code | name | required | extras', ...body].join('\n');
}

/* -------------------------------------------------------------- templates -- */

export interface TemplateWithLines {
  template: Template;
  lines: TemplateLine[];
}

/**
 * The templates that fit this destination: its type, and where the template
 * says which vehicle access it suits, this access too. Whole-event templates
 * are left out; they describe a truck, not a station.
 */
export function relevantTemplates(all: TemplateWithLines[], destination: Destination): TemplateWithLines[] {
  return all.filter(({ template }) => {
    if (template.deletedAt) return false;
    if ((template.scope ?? 'site') !== 'site') return false;
    if (template.appliesTo !== destination.type) return false;
    if (template.suitsAccess?.length && !template.suitsAccess.includes(destination.access)) return false;
    return true;
  });
}

export function renderTemplates(templates: TemplateWithLines[], items: Map<string, Item>): string {
  if (!templates.length) return 'No template covers this kind of destination.';
  return templates
    .map(({ template, lines }) => {
      const head = `Template "${template.name}"${template.description.trim() ? `: ${template.description.trim()}` : ''}`;
      const body = lines
        .filter((line) => !line.deletedAt)
        .map((line) => {
          const item = items.get(line.itemId);
          const parts = [item?.sku ?? '?', item?.name ?? 'Unknown item', line.perRunner ? `${line.qty} per runner` : `${line.qty}`];
          if (line.mandatory) parts.push('must-have');
          if (line.note.trim()) parts.push(`note: ${line.note.trim()}`);
          return `  ${parts.join(' | ')}`;
        });
      return [head, ...body].join('\n');
    })
    .join('\n');
}

/* -------------------------------------------------------------- food plan -- */

export function renderFoodPlan(
  rules: ConsumptionLine[],
  destination: Destination,
  races: Race[],
  items: Map<string, Item>,
): string {
  const live = rules.filter((rule) => !rule.deletedAt && rule.destinationId === destination.id);
  if (!live.length) return 'The food plan has no rules for this destination.';
  const lines = live.map((rule) => {
    const item = items.get(rule.itemId);
    const qty = lineTotal(rule, destination, races);
    return `${item?.sku ?? '?'} | ${item?.name ?? 'Unknown item'} | ${item ? formatQty(qty, item.unit) : qty} for the event`;
  });
  return ['Format: code | name | quantity the plan calls for', ...lines].join('\n');
}

/* ---------------------------------------------------------------- history -- */

export interface HistoricalList {
  event: RaceEvent;
  destination: Destination;
  packlist: Packlist;
  lines: PacklistLine[];
}

/** "Aid 3 – Buffalo Plateau", "aid 3 buffalo plateau" and "AID 3 BUFFALO PLATEAU" are one station. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d{4}/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Earlier editions of this station: destinations at other events with the
 * same name, most recent event first. The list that actually went out is what
 * matters, so lists that never left draft are skipped when a later stage
 * exists.
 */
export function pickHistory(
  here: { event: RaceEvent; destination: Destination },
  candidates: HistoricalList[],
  limit = HISTORY_LIMIT,
): HistoricalList[] {
  const wanted = normaliseName(here.destination.name);
  return candidates
    .filter(
      (entry) =>
        entry.event.id !== here.event.id &&
        normaliseName(entry.destination.name) === wanted &&
        entry.lines.some((line) => !line.deletedAt),
    )
    .sort((a, b) => b.event.startDate.localeCompare(a.event.startDate))
    .slice(0, limit);
}

/** Other stations of the same kind at this event, with lines on them. */
export function pickSiblings(
  here: { event: RaceEvent; destination: Destination },
  candidates: HistoricalList[],
  limit = SIBLING_LIMIT,
): HistoricalList[] {
  return candidates
    .filter(
      (entry) =>
        entry.event.id === here.event.id &&
        entry.destination.id !== here.destination.id &&
        entry.destination.type === here.destination.type &&
        entry.lines.some((line) => !line.deletedAt),
    )
    .sort((a, b) => statusIndex(b.packlist.status) - statusIndex(a.packlist.status))
    .slice(0, limit);
}

export function renderHistory(
  previous: HistoricalList[],
  siblings: HistoricalList[],
  items: Map<string, Item>,
): string {
  const sections: string[] = [];
  if (previous.length) {
    sections.push('Earlier editions of this station:');
    for (const entry of previous) sections.push(renderHistorical(entry, items));
  } else {
    sections.push('No earlier edition of this station is on record.');
  }
  if (siblings.length) {
    sections.push(`Other ${DESTINATION_LABELS[siblings[0].destination.type].toLowerCase()} lists at this event:`);
    for (const entry of siblings) sections.push(renderHistorical(entry, items));
  }
  return sections.join('\n');
}

function renderHistorical(entry: HistoricalList, items: Map<string, Item>): string {
  const went = statusIndex(entry.packlist.status) >= statusIndex('loaded');
  const head = `${entry.event.name}, ${entry.destination.name} (${ACCESS_LABELS[entry.destination.access]}), list status ${entry.packlist.status}${
    went ? ', these quantities left the warehouse' : ''
  }:`;
  const body = entry.lines
    .filter((line) => !line.deletedAt)
    .map((line) => {
      const item = items.get(line.itemId);
      const qty = went && line.qtyPacked > 0 ? line.qtyPacked : line.qtyRequired;
      return `  ${item?.sku ?? '?'} | ${item?.name ?? 'Unknown item'} | ${item ? formatQty(qty, item.unit) : qty}`;
    });
  return [head, ...body].join('\n');
}

/* ------------------------------------------------------------------ notes -- */

export function renderNotes(notes: AssistantNote[], eventName: string): string {
  if (!notes.length) return 'No notes have been written yet.';
  return notes
    .map((note) => {
      const where = note.eventId
        ? `[${eventName}${note.destinationType ? `, ${DESTINATION_LABELS[note.destinationType].toLowerCase()} lists` : ''}]`
        : note.destinationType
          ? `[${DESTINATION_LABELS[note.destinationType]} lists]`
          : '[everywhere]';
      return `- ${where} ${note.text}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ build -- */

/**
 * Read everything a check needs from the local database.
 *
 * Returns undefined when the list, its destination or its event cannot be
 * found, which on a phone means the record has not synced yet or has been
 * deleted under it.
 */
export async function buildCheckRequest(packlistId: string): Promise<CheckRequest | undefined> {
  const packlist = await db.packlists.get(packlistId);
  if (!packlist || packlist.deletedAt) return undefined;
  const [destination, event] = await Promise.all([
    db.destinations.get(packlist.destinationId),
    db.events.get(packlist.eventId),
  ]);
  if (!destination || !event) return undefined;

  const [items, categories, lines, races, rules, templates, templateLines, notes] = await Promise.all([
    alive(await db.items.toArray()),
    alive(await db.categories.toArray()),
    liveWhere(db.packlistLines, 'packlistId', packlist.id),
    liveWhere(db.races, 'eventId', event.id),
    liveWhere(db.consumptionLines, 'eventId', event.id),
    alive(await db.templates.toArray()),
    alive(await db.templateLines.toArray()),
    alive(await db.assistantNotes.toArray()),
  ]);
  const itemMap = byId(items);

  const withLines: TemplateWithLines[] = templates.map((template) => ({
    template,
    lines: templateLines.filter((line) => line.templateId === template.id).sort((a, b) => a.sort - b.sort),
  }));

  const candidates = await historicalLists(packlist.id);

  return {
    kind: 'check',
    catalogue: renderCatalogue(items, categories),
    station: renderStation({ event, destination, races }),
    packlist: renderPacklist(packlist, lines, itemMap),
    templates: renderTemplates(relevantTemplates(withLines, destination), itemMap),
    foodPlan: renderFoodPlan(rules, destination, races, itemMap),
    history: renderHistory(
      pickHistory({ event, destination }, candidates),
      pickSiblings({ event, destination }, candidates),
      itemMap,
    ),
    notes: renderNotes(notesFor(notes, { eventId: event.id, destinationType: destination.type }), event.name),
  };
}

/** Every other station's working list, with its event and destination attached. */
async function historicalLists(excludePacklistId: string): Promise<HistoricalList[]> {
  const [events, destinations, packlists, allLines] = await Promise.all([
    alive(await db.events.toArray()),
    alive(await db.destinations.toArray()),
    alive(await db.packlists.toArray()),
    alive(await db.packlistLines.toArray()),
  ]);
  const eventMap = byId(events);
  const linesByPacklist = new Map<string, PacklistLine[]>();
  for (const line of allLines) {
    linesByPacklist.set(line.packlistId, [...(linesByPacklist.get(line.packlistId) ?? []), line]);
  }
  const byDestination = new Map<string, Packlist[]>();
  for (const packlist of packlists) {
    if (packlist.id === excludePacklistId) continue;
    byDestination.set(packlist.destinationId, [...(byDestination.get(packlist.destinationId) ?? []), packlist]);
  }

  const out: HistoricalList[] = [];
  for (const destination of destinations) {
    const event = eventMap.get(destination.eventId);
    const candidates = byDestination.get(destination.id);
    if (!event || !candidates?.length) continue;
    const packlist = primaryPacklist(candidates, (entry) => linesByPacklist.get(entry.id)?.length ?? 0);
    if (!packlist) continue;
    out.push({ event, destination, packlist, lines: linesByPacklist.get(packlist.id) ?? [] });
  }
  return out;
}
