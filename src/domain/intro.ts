import { isStationOnly } from '../sync/permissions';
import type { Role, Session } from '../sync/types';

/**
 * The welcome tour: three short pages, chosen by what the person does.
 *
 * The old tour ran to seven pages and opened with words nobody knows on day
 * one: truck stage, vans, loaded. First-time testers skipped it or came out
 * more confused. Now each person hears only the three things their own job
 * needs, in plain words, and learns the rest by using it. Shown once per
 * role on each device, and again whenever someone taps "How this works".
 */

export interface IntroStep {
  glyph: string;
  title: string;
  body: string[];
}

/** Which tour someone gets, read from what their account can do. */
export type IntroKind = 'station' | 'packer' | 'driver' | 'admin';

/** The most pages any tour may have. Keep it short or nobody reads it. */
export const MAX_INTRO_STEPS = 3;

function hello(name: string): string {
  return name ? `Hi ${name}` : 'Hi there';
}

function stepsFor(kind: IntroKind, name: string): IntroStep[] {
  switch (kind) {
    case 'station':
      return [
        {
          glyph: '👋',
          title: hello(name),
          body: ['This is your station\'s list: everything the warehouse is sending you.'],
        },
        {
          glyph: '✅',
          title: 'Tick each item as it arrives',
          body: [
            'Tap an item to tick it. If fewer came than the list says, use − and + to show how many.',
            'No signal is fine. Your ticks are saved and sent when the device finds signal.',
          ],
        },
        {
          glyph: '🏁',
          title: 'Tap Done when everything is checked',
          body: ['That tells the crew your station has what it needs. Anything still short is easy to see.'],
        },
      ];
    case 'packer':
      return [
        {
          glyph: '👋',
          title: hello(name),
          body: ['Pick a station from the event to see what it needs packed.'],
        },
        {
          glyph: '✅',
          title: 'Tick items as you pack',
          body: ['Tap an item to tick it packed. Use − and + if you only have some of it.'],
        },
        {
          glyph: '📦',
          title: 'The warehouse list shows everything',
          body: ['It adds up every station\'s items for the event, in shelf order, so you walk the racks once.'],
        },
      ];
    case 'driver':
      return [
        {
          glyph: '👋',
          title: hello(name),
          body: ['The event shows each station and the vehicle that takes its gear.'],
        },
        {
          glyph: '🚐',
          title: 'Check before you leave',
          body: ['Open a station to see its list, so you can check the crates before you drive off.'],
        },
        {
          glyph: '✅',
          title: 'The station ticks it in',
          body: ['Nothing to sign. The station ticks each item as it comes off, and that is the record.'],
        },
      ];
    case 'admin':
      return [
        {
          glyph: '👋',
          title: hello(name),
          body: ['Start by setting up the event and its stations.'],
        },
        {
          glyph: '📋',
          title: 'Each station gets a packing list',
          body: ['A new station starts from last year\'s list for the same place, so there is less to type.'],
        },
        {
          glyph: '🛒',
          title: 'See what is missing',
          body: ['The What\'s missing screen tells you what still needs packing, and what to buy.'],
        },
      ];
  }
}

/**
 * Which tour fits this account.
 *
 * A volunteer, or anyone kept to one station, is at that station whatever
 * else they were given. Crew pack. Only an admin sets events up.
 */
export function introKind(session: Session | null): IntroKind {
  // A device with no account is run by whoever set it up.
  if (!session) return 'admin';
  if (session.role === 'volunteer' || isStationOnly(session)) return 'station';
  if (session.role === 'driver') return 'driver';
  if (session.role === 'admin') return 'admin';
  return 'packer';
}

/** The tour for whoever is on this device, greeting them by name when known. */
export function introFor(
  session: Session | null,
  fallbackName = '',
): { role: Role; kind: IntroKind; steps: IntroStep[] } {
  const role = session?.role ?? 'admin';
  const kind = introKind(session);
  const first = (session?.displayName || fallbackName).trim().split(/\s+/)[0] ?? '';
  // A fresh device is stamped "Warehouse" as its crew name, which is a place,
  // not a person. "Hi Warehouse" is worse than no name at all.
  const name = first.toLowerCase() === 'warehouse' ? '' : first;
  return { role, kind, steps: stepsFor(kind, name) };
}

const SEEN_KEY = (role: Role) => `intro:seen:${role}`;

/** True once this device has shown (or been told to skip) this role's tour. */
export function hasSeenIntro(role: Role): boolean {
  try {
    return localStorage.getItem(SEEN_KEY(role)) === '1';
  } catch {
    // Storage blocked: never nag, the tour is still a tap away.
    return true;
  }
}

export function markIntroSeen(role: Role): void {
  try {
    localStorage.setItem(SEEN_KEY(role), '1');
  } catch {
    // Nothing to remember it in; it may show again, which is harmless.
  }
}

/** Ask the tour to open, from anywhere. */
export function openIntro(): void {
  window.dispatchEvent(new Event('open-intro'));
}
