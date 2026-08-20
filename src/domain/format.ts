import type { AccessType, DestinationType, EventStatus, Item, Unit } from '../db/types';

/** Presentation helpers. Australian date conventions throughout. */

const DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : `${DATE_SHORT.format(date)}, ${TIME.format(date)}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : TIME.format(date);
}

/** A date range, collapsing single-day events to one date. */
export function formatDateRange(start: string, end: string): string {
  if (!end || end === start) return formatDate(start);
  return `${DATE_SHORT.format(new Date(`${start}T00:00:00`))} – ${formatDate(end)}`;
}

/** "in 3 days", "today", "6 weeks ago". */
export function relativeDays(isoDate: string): string {
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
  const ago = Math.abs(days);
  return ago < 14 ? `${ago} days ago` : `${Math.round(ago / 7)} weeks ago`;
}

/** Days until an event, negative once it has passed. */
export function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Short unit labels as [singular, plural]. Written out rather than derived,
 * because "box" pluralises to "boxes" and measures like L and kg never
 * pluralise at all.
 */
const UNIT_SHORT: Record<Unit, [string, string]> = {
  each: ['', ''],
  box: ['box', 'boxes'],
  carton: ['ctn', 'ctns'],
  pallet: ['plt', 'plts'],
  roll: ['roll', 'rolls'],
  pack: ['pk', 'pks'],
  litre: ['L', 'L'],
  kg: ['kg', 'kg'],
  bag: ['bag', 'bags'],
};

/** "12 ctns", "3", "40 L" — the unit is dropped for plain countable things. */
export function formatQty(qty: number, unit: Unit): string {
  const value = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
  const [singular, plural] = UNIT_SHORT[unit];
  if (!singular) return value;
  return `${value} ${qty === 1 ? singular : plural}`;
}

/** Quantity plus the piece count when items come in packs. */
export function formatQtyDetail(item: Item, qty = item.qtyOnHand): string {
  const base = formatQty(qty, item.unit);
  if (!item.packSize || item.packSize <= 1) return base;
  return `${base} · ${Math.round(qty * item.packSize)} ea`;
}

export const DESTINATION_LABELS: Record<DestinationType, string> = {
  aid_station: 'Aid station',
  event_village: 'Event village',
  start: 'Start line',
  finish: 'Finish line',
  checkpoint: 'Checkpoint',
  water_drop: 'Water drop',
  store: 'Store / cache',
};

export const DESTINATION_ICONS: Record<DestinationType, string> = {
  aid_station: '⛺',
  event_village: '🏘️',
  start: '🚩',
  finish: '🏁',
  checkpoint: '📍',
  water_drop: '💧',
  store: '📦',
};

export const ACCESS_LABELS: Record<AccessType, string> = {
  '2wd': '2WD access',
  '4wd': '4WD only',
  atv: 'ATV / quad',
  foot: 'Walk-in',
  helicopter: 'Heli drop',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  planning: 'Planning',
  packing: 'Packing',
  live: 'Live',
  debrief: 'Debrief',
  closed: 'Closed',
};

/** Pluralise a count: `plural(1, 'crate')` → "1 crate". */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/** Initials for an avatar chip. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
