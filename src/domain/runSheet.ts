import type { Destination, PacklistLine, StationWindow } from '../db/types';
import { isConfirmed, received } from './packlists';

/**
 * The paper run sheet, on the phone.
 *
 * A volunteer at a station opens the sheet for four things before anything
 * else: when the station runs, who their crew lead is, which vehicle brings
 * the gear and how to get in. These helpers put those facts in the words a
 * printed sheet would use.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Thu 5 Nov 07:15" from a local "2026-11-05T07:15".
 *
 * Read as written, never through the Date parser's time zone: a station's
 * 07:15 is 07:15 at the station, whatever the phone thinks.
 */
export function formatLocalWhen(local: string | null | undefined): string {
  if (!local) return '';
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return local;
  const [, year, month, day, hour, minute] = match;
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  const date = `${DAYS[weekday]} ${Number(day)} ${MONTHS[Number(month) - 1]}`;
  return hour ? `${date} ${hour}:${minute}` : date;
}

/** One window as a line of the sheet: "Miler · Fri 6 Nov 09:26 to Fri 6 Nov 12:00". */
export function describeWindow(window: StationWindow): string {
  const first = formatLocalWhen(window.firstRunner);
  if (!window.cutoff) return `${window.label} · ${first ? `${first}, ` : ''}start only`;
  const cutoff = formatLocalWhen(window.cutoff);
  // Same day twice reads as noise: "Fri 6 Nov 09:26 to 12:00".
  const sameDay = window.firstRunner?.slice(0, 10) === window.cutoff.slice(0, 10);
  const end = sameDay && window.cutoff.length > 10 ? window.cutoff.slice(11, 16) : cutoff;
  return `${window.label} · ${first || '?'} to ${end}`;
}

/**
 * When the station runs, one line per window. Falls back to the plain open
 * and close times, and to nothing at all: a blank says "not known yet",
 * where a guess would be read as fact.
 */
export function stationHours(destination: Pick<Destination, 'openTime' | 'closeTime' | 'schedule'>): string[] {
  const windows = destination.schedule?.windows ?? [];
  if (windows.length) return windows.map(describeWindow);
  if (destination.openTime || destination.closeTime) {
    return [`${destination.openTime || '?'} to ${destination.closeTime || '?'}`];
  }
  return [];
}

/**
 * A WhatsApp chat link for an Australian mobile, or null when the number
 * cannot be one. Event comms run through WhatsApp, and at a Starlink station
 * with no mobile signal a `tel:` link goes nowhere.
 */
export function whatsappLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `61${digits.slice(1)}`;
  digits = digits.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}

export interface CheckIn {
  /** Lines somebody has answered for, short or not. */
  checked: number;
  total: number;
  /** Answered, and fewer than were sent. */
  short: number;
  done: boolean;
}

/**
 * How far the station is through checking the van in.
 *
 * A line is checked once anyone has said how many arrived, even if that is
 * fewer than were sent: the volunteer's job is to say what turned up, not to
 * make it add up. So a station with something short still finishes.
 */
export function checkInFor(lines: PacklistLine[], expected: (line: PacklistLine) => number): CheckIn {
  const live = lines.filter((line) => !line.deletedAt);
  const checked = live.filter(isConfirmed);
  const short = checked.filter((line) => received(line) < expected(line)).length;
  return {
    checked: checked.length,
    total: live.length,
    short,
    done: live.length > 0 && checked.length === live.length,
  };
}

/** "22 of 22 checked · 2 short". */
export function describeCheckIn(checkIn: CheckIn): string {
  const base = `${checkIn.checked} of ${checkIn.total} checked`;
  return checkIn.short ? `${base} · ${checkIn.short} short` : base;
}

export type Delivery = 'phone-only' | 'sending' | 'waiting' | 'sent';

/**
 * Where the station's answers are: still only on this phone, on their way,
 * or at the warehouse. The volunteer cannot see the sync engine, but they can
 * be told whether they can put the phone away.
 */
export function deliveryOf(
  lines: PacklistLine[],
  sync: { connected: boolean; sending: boolean },
): Delivery {
  if (!sync.connected) return 'phone-only';
  const unsent = lines.some((line) => !line.syncedAt);
  if (!unsent) return 'sent';
  return sync.sending ? 'sending' : 'waiting';
}

export const DELIVERY_LABELS: Record<Delivery, string> = {
  'phone-only': 'Saved on this phone',
  sending: 'Sending now',
  waiting: 'It sends when the phone is next online',
  sent: 'Sent to the warehouse',
};
