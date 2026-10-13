import type { Role, Session } from '../sync/types';

/**
 * The welcome tour, one per access level.
 *
 * Each role sees only what its tabs can reach: a volunteer at an aid station
 * hears about their one packlist, not the warehouse. Shown once per role on
 * each phone, and again whenever someone asks for it from More or their
 * station screen.
 */

export interface IntroStep {
  glyph: string;
  title: string;
  body: string[];
}

const INSTALL: IntroStep = {
  glyph: '📲',
  title: 'Put it on your home screen',
  body: [
    'Open the menu in your browser and choose "Add to Home Screen". The app then opens like any other and keeps working with no reception.',
    'On an iPhone the home-screen app signs in separately from Safari. If it asks you to sign in, tap "Have an invite code?" and use the same code again.',
  ],
};

const PACKING: IntroStep = {
  glyph: '✅',
  title: 'Packing a list',
  body: [
    'Open a station from the event, tap a line to tick it packed, and use the − and + for a part count.',
    'The card "Usually goes with this list" offers what the pack rules say is missing: straps and weights for marquees, a cloth for every trestle, an RCD with every generator. Tap Add, or Not needed.',
    'Work the list along with the big button at the bottom: Start picking, Mark packed, Mark loaded. Loading takes the stock out of the warehouse.',
  ],
};

const WAREHOUSE: IntroStep = {
  glyph: '📦',
  title: 'The warehouse list',
  body: [
    'From an event, Warehouse list totals every item across every station, in shelf order, so the racks get walked once.',
    'Tick an item and it is packed on every station\'s list at once. Open the item to tick one station at a time. "To pack" hides what is done.',
  ],
};

const STEPS: Record<Role, IntroStep[]> = {
  admin: [
    {
      glyph: '👋',
      title: 'Welcome, admin',
      body: [
        'This is where SingleTrack\'s gear gets packed, moved and counted for every event, from the shed to the last aid station.',
        'You can do everything, including the catalogue and who else gets access. Here is the tour.',
      ],
    },
    {
      glyph: '🏃',
      title: 'Events and stations',
      body: [
        'Events holds the season. Each event has its stations, and each station has one packlist.',
        'Import pack list reads the crew\'s spreadsheets and PDF run sheets. Food plan turns runner projections into food and drink for each station, and sends it to the lists.',
        'A station showing "2 lists" has a duplicate: open the extra one and delete it under "Start this list again, or delete it".',
      ],
    },
    PACKING,
    WAREHOUSE,
    {
      glyph: '🛒',
      title: 'Stock, stocktakes and shopping',
      body: [
        'Stock is the catalogue, with every change recorded. Run a stocktake from More to count the racks.',
        'The shopping list collects what is short, from the food plan, low stock and packing. Tick lines in the shop, then book them into stock in one tap.',
      ],
    },
    {
      glyph: '👥',
      title: 'Bringing people in',
      body: [
        'More, then Accounts & sync, then New invite. Pick Crew, Driver or Volunteer, and the event or aid station.',
        'They scan the QR and type their name. No email needed. Print volunteer QRs with the crate labels for each station.',
      ],
    },
    INSTALL,
  ],
  crew: [
    {
      glyph: '👋',
      title: 'Welcome to the crew',
      body: [
        'You pack the gear, plan the food and build the transport runs for your events.',
        'Here is how the app fits the job, in a minute.',
      ],
    },
    {
      glyph: '🏃',
      title: 'Your events',
      body: [
        'Events lists what you are working on. Open one to see its stations, each with its own packlist.',
        'Food plan works out each station\'s food and drink from the runner numbers and sends it to the lists. Send it again whenever the numbers change.',
      ],
    },
    PACKING,
    WAREHOUSE,
    {
      glyph: '🚚',
      title: 'Transport and stock',
      body: [
        'Transport puts stations onto vehicles, so everyone knows what goes in the Hilux.',
        'Stock shows what is in the shed. If something is short, add it to the shopping list from the item or the packlist line.',
      ],
    },
    INSTALL,
  ],
  driver: [
    {
      glyph: '👋',
      title: 'Welcome, driver',
      body: [
        'You take the gear out to the stations and confirm it arrived.',
      ],
    },
    {
      glyph: '🚚',
      title: 'Your runs',
      body: [
        'Transport shows the runs you are on, with the stops in order and what goes to each.',
        'Open a stop to see its packlist, so you can check the crates before you leave the shed.',
      ],
    },
    {
      glyph: '✍️',
      title: 'At each stop',
      body: [
        'Tap Confirm delivery and type the name of whoever took the crates. Add a note if anything was missing or damaged.',
        'The warehouse sees it as soon as your phone has signal.',
      ],
    },
    INSTALL,
  ],
  volunteer: [
    {
      glyph: '👋',
      title: 'Welcome to your aid station',
      body: [
        'This app shows your station\'s packlist: everything the warehouse sent you.',
      ],
    },
    {
      glyph: '📦',
      title: 'Checking the delivery in',
      body: [
        'Tap Open the packlist. As each item turns up, tap its line to tick it off.',
        'If fewer arrived than the list says, use the − and + to record how many actually came. The warehouse sees the difference.',
      ],
    },
    {
      glyph: '📶',
      title: 'No signal? No problem',
      body: [
        'Everything works with no reception. Your ticks are kept on the phone and sent as soon as it finds signal.',
        'Running low on something on the day? Phone the Operations Manager early, not when it has run out.',
      ],
    },
    INSTALL,
  ],
};

/** The tour for whoever is on this phone. A phone with no account is run by its owner. */
export function introFor(session: Session | null): { role: Role; steps: IntroStep[] } {
  const role = session?.role ?? 'admin';
  return { role, steps: STEPS[role] };
}

const SEEN_KEY = (role: Role) => `intro:seen:${role}`;

/** True once this phone has shown (or been told to skip) this role's tour. */
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
