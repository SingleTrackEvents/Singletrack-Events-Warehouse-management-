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
    'On an iPhone the home-screen app signs in separately from Safari. If it asks you to sign in, tap "Scan invite QR" and scan the same card again.',
  ],
};

const PACKING: IntroStep = {
  glyph: '✅',
  title: 'Packing a list',
  body: [
    'Open a station from the board, tap a line to tick it packed, and use the − and + for a part count.',
    'The card "Usually goes with this list" offers what the pack rules say is missing: straps and weights for marquees, a cloth for every trestle, an RCD with every generator. Tap Add, or Not needed.',
    'Nothing to mark. Where a list is up to (planned, on the truck, in the van, at the station, home) is read from the numbers on it, and the board shows every station at a glance.',
  ],
};

const WAREHOUSE: IntroStep = {
  glyph: '📦',
  title: 'The warehouse list',
  body: [
    'From an event, Warehouse list totals every item across every station, in shelf order, so the racks get walked once.',
    'Tick an item and it is packed on every station\'s list at once. Open the item to tick one station at a time. "To pack" hides what is done. Loaded is the one button that takes stock out of the warehouse.',
    'Going out in one big truck? Turn on Truck stage in Edit event. The warehouse list then ticks gear onto the truck, each station\'s list becomes its van pack at the event, and Vans shows what is still on the truck once the vans start taking from it.',
    'After the event, Home mirrors the warehouse list: what each station counted against what has come back, and one button to book it onto the shelf.',
  ],
};

const STEPS: Record<Role, IntroStep[]> = {
  admin: [
    {
      glyph: '👋',
      title: 'Welcome, admin',
      body: [
        'This is where SingleTrack\'s gear gets packed, moved and counted for every event, from the warehouse to the last aid station.',
        'You can do everything, including the catalogue and who else gets access. Here is the tour.',
      ],
    },
    {
      glyph: '🏃',
      title: 'Events and stations',
      body: [
        'The board is the next event: its stations, where each one is up to, and the one thing to do next. All events is a tap away. A new station starts with last year\'s list for the same station.',
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
        'Stock is the catalogue, with every change recorded. Run a stocktake from Stock to count the racks between events.',
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
        'You pack the gear, plan the food and get it to the stations and home again.',
        'Here is how the app fits the job, in a minute.',
      ],
    },
    {
      glyph: '🏃',
      title: 'Your events',
      body: [
        'The board shows the next event and where every station is up to. Open a station to pack its list; set its vehicle under Edit.',
        'Food plan works out each station\'s food and drink from the runner numbers and sends it to the lists. Send it again whenever the numbers change.',
      ],
    },
    PACKING,
    WAREHOUSE,
    {
      glyph: '📦',
      title: 'Out and home',
      body: [
        'The warehouse list is the pick list for the whole event, by item or by vehicle. Loaded takes the stock out, once. Home counts it back in, once.',
        'Stock shows what is in the warehouse. If something is short, add it to the shopping list from the item or the packlist line.',
      ],
    },
    INSTALL,
  ],
  driver: [
    {
      glyph: '👋',
      title: 'Welcome, driver',
      body: [
        'You take the gear out to the stations. The station checks it in off the van.',
      ],
    },
    {
      glyph: '🚐',
      title: 'Your stations',
      body: [
        'The board shows the event\'s stations and the vehicle each one travels in.',
        'Open a station to see its packlist, so you can check the crates before you leave the warehouse.',
      ],
    },
    {
      glyph: '✅',
      title: 'At each stop',
      body: [
        'Nothing to sign. The station ticks each line as it comes off the van, and that is the record of the delivery.',
        'If you are checking in for a station, open its list and tap Arrived. The warehouse sees it as soon as the phone has signal.',
      ],
    },
    INSTALL,
  ],
  volunteer: [
    {
      glyph: '👋',
      title: 'Welcome to your aid station',
      body: [
        'This app shows your station\'s packlist: everything the warehouse sent you, and the three jobs over the day: Arrived, Count, Pack down.',
      ],
    },
    {
      glyph: '📦',
      title: 'Checking the delivery in',
      body: [
        'Tap Arrived. As each item comes off the van, tap its line to tick it off. If fewer arrived than the list says, use the − and + to record how many actually came. The warehouse sees the difference.',
        'At the end of the day tap Count and put a number on what is left of everything that gets used up: food, drink, sunscreen, paper towel. Then tap Pack down and tick the gear as it goes back in the van.',
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
