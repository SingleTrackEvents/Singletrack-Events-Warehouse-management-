import type { AccessType, DestinationType, EventStatus } from './types';

/**
 * The season's events, with their aid stations.
 *
 * Compiled September 2026 from the public race pages (singletrack.com.au,
 * buffalostampede.au, gpt100.com.au, hounslowclassic.com.au,
 * rollercoasterrun.com, puffingbillyrunningfestival.com.au) and the crew's own
 * operations documents — the WR26 Aid Station Manual and the HC 2026
 * consumption planner. Dates marked PROJECTED in the notes were not announced
 * at the time of writing; everything else was confirmed on the event's site.
 *
 * Seeded once with stable ids, so the crew can rename, re-date and delete
 * freely — a removed event stays removed, and edits are never overwritten.
 */

export interface SeedDestination {
  name: string;
  type: DestinationType;
  courseKm?: number;
  access?: AccessType;
  accessNotes?: string;
  notes?: string;
  /** Race names from this event's `races`, with how many times each passes. */
  visits?: Array<[race: string, passes: number]>;
}

export interface SeedEvent {
  /** Stable per-edition code the seeded ids derive from, e.g. "hc26". */
  code: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  status?: EventStatus;
  notes?: string;
  /** Race distances, with projected fields where the planning sheets have them. */
  races?: Array<{ name: string; projection: number; day?: string }>;
  destinations: SeedDestination[];
}

export const EVENT_SEED: SeedEvent[] = [
  {
    code: 'hc26',
    name: 'Hounslow Classic 2026',
    location: 'Blackheath, NSW',
    startDate: '2026-09-11',
    endDate: '2026-09-13',
    status: 'packing',
    notes:
      'Village at Allview Escape, 415–419 Hat Hill Rd. Marathon Sat 6:15 am (overall cutoff 8:00 pm), ' +
      '17k Sun, kids race Sun. Projections from the HC 2026 consumption planner.',
    races: [
      { name: 'Marathon', projection: 450, day: '2026-09-12' },
      { name: '17k', projection: 612, day: '2026-09-13' },
      { name: 'Kids', projection: 80, day: '2026-09-13' },
    ],
    destinations: [
      {
        name: 'Allview Escape',
        type: 'event_village',
        notes: 'Event village and start/finish. Marathon drop bags at the ~17 km pass; passed again inbound.',
        visits: [['Marathon', 2], ['17k', 1], ['Kids', 1]],
      },
      {
        name: 'Grand Canyon Carpark',
        type: 'aid_station',
        notes: 'Crew access allowed. On both the marathon and the 17k loop.',
        visits: [['Marathon', 1], ['17k', 1]],
      },
      {
        name: 'Perrys Lookdown',
        type: 'aid_station',
        accessNotes: 'No crew vehicles — race and medical vehicles only.',
        notes: 'Hot food. Marathon passes outbound and inbound.',
        visits: [['Marathon', 2]],
      },
      {
        name: 'Blue Gum Forest',
        type: 'checkpoint',
        access: 'foot',
        notes: 'Valley floor, walk-in. Water and lollies only in the consumption plan.',
        visits: [['Marathon', 1]],
      },
      {
        name: 'The Pinnacles Car Park',
        type: 'aid_station',
        accessNotes: 'Parking reserved for race and medical vehicles — no crew.',
        notes: 'Marathon turnaround. Hot food and drop bags.',
        visits: [['Marathon', 1]],
      },
      {
        name: 'Recovery Zone',
        type: 'finish',
        notes: 'Finish-line recovery area at Allview Escape — its own load-out in the run sheets.',
      },
    ],
  },
  {
    code: 'pbrf26',
    name: 'Puffing Billy Running Festival 2026',
    location: 'Belgrave–Emerald, VIC',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    notes:
      '13.5 km Classic races the steam train Belgrave → Emerald, Sun 8:45 am; 5 km and kids at ' +
      'Emerald Lake Park on the Saturday. Cup-free drink stations; on-course station details not published.',
    destinations: [
      {
        name: 'Emerald Lake Park Village',
        type: 'event_village',
        notes: 'Finish line and Saturday events, at the Puffing Billy Lakeside Visitor Centre.',
      },
      { name: 'Belgrave Start', type: 'start', notes: 'Classic start, Sunday 8:45 am.' },
    ],
  },
  {
    code: 'rcr26',
    name: 'Roller Coaster Run 2026',
    location: 'Kalorama, VIC',
    startDate: '2026-10-17',
    endDate: '2026-10-17',
    notes: '46 km, 23 km, 12 km twilight and kids, out of Kalorama Memorial Reserve.',
    destinations: [
      {
        name: 'Kalorama Event Village',
        type: 'event_village',
        notes: 'Start/finish and the 46 km turnaround (21.5 km, cutoff 1:45 pm).',
      },
      {
        name: 'Doongalla Picnic Grounds',
        type: 'aid_station',
        notes:
          'Passed twice on the 23 km and four times on the 46 km (4th pass 37 km, cutoff 5:00 pm). ' +
          'Stocked: electrolyte, water, Coke, ginger beer, lollies, chips, fruit, sunscreen.',
      },
    ],
  },
  {
    code: 'gpt26',
    name: 'GPT100 2026',
    location: 'Grampians (Gariwerd), VIC',
    startDate: '2026-11-05',
    endDate: '2026-11-08',
    notes:
      'Mt Zero → Dunkeld, 162 km, 50 h limit; miler starts Fri 6 Nov 8:00 am. Hub at Halls Gap. ' +
      'Every station Trail Sisters compliant, with ice, salt and sunscreen. Km and cutoffs from gpt100.com.au.',
    destinations: [
      { name: 'Mt Zero Picnic Area', type: 'start', courseKm: 0, notes: 'Miler and stage race start.' },
      { name: 'GAR Trailhead', type: 'aid_station', courseKm: 15.5, notes: 'Crew OK. Cutoff Fri 12:00 pm.' },
      {
        name: 'Mt Difficult Rd',
        type: 'aid_station',
        courseKm: 35.5,
        accessNotes: 'No crew access.',
        notes: 'Hot soup and noodles. Cutoff Fri 5:00 pm.',
      },
      {
        name: 'Halls Gap',
        type: 'aid_station',
        courseKm: 49.5,
        notes: 'Full crew access, drop bags. Stage 1 finish. Cutoff Fri 8:00 pm.',
      },
      {
        name: 'Rosea Carpark',
        type: 'aid_station',
        courseKm: 59,
        notes: 'Crew OK, 12 min from Halls Gap. Hot meals. Cutoff Fri 11:00 pm.',
      },
      {
        name: 'Borough Huts',
        type: 'aid_station',
        courseKm: 72,
        notes: 'Crew OK. Nap beds. Cutoff Sat 2:15 am.',
      },
      {
        name: 'Mt William Carpark',
        type: 'aid_station',
        courseKm: 87,
        accessNotes: 'No crew access.',
        notes: 'Drop bags, nap beds. Stage 2 finish. Cutoff Sat 8:15 am.',
      },
      {
        name: 'Jimmy Creek Rd',
        type: 'aid_station',
        courseKm: 106,
        accessNotes: 'Limited crew parking.',
        notes: 'Drop bags, nap beds. Cutoff Sat 2:30 pm.',
      },
      {
        name: 'Yarram Gap Rd',
        type: 'aid_station',
        courseKm: 117,
        accessNotes: 'No crew access.',
        notes: 'Hot meals. Cutoff Sat 6:30 pm.',
      },
      {
        name: 'Griffin Fireline',
        type: 'aid_station',
        courseKm: 129,
        accessNotes: 'Shuttle access only.',
        notes: 'Drop bags, nap beds. Stage 3 finish. Cutoff Sat 10:15 pm.',
      },
      {
        name: 'Cassidys Gap',
        type: 'aid_station',
        courseKm: 140.5,
        accessNotes: 'Shuttle access only.',
        notes: 'Stage 4 / GPT33 start. Cutoff Sun 2:00 am.',
      },
      {
        name: 'Bainggug Carpark',
        type: 'aid_station',
        courseKm: 151.5,
        accessNotes: 'Shuttle access only.',
        notes: 'Cutoff Sun 6:30 am.',
      },
      {
        name: 'Dunkeld Finish',
        type: 'finish',
        courseKm: 162,
        notes: 'Full access, 46 min from Halls Gap. Course closes Sun 10:00 am.',
      },
    ],
  },
  {
    code: 'buller26',
    name: 'Mt Buller SkyRun 2026',
    location: 'Mount Buller, VIC',
    startDate: '2026-12-06',
    endDate: '2026-12-06',
    notes: '45 km, 36 km, 22 km, 5 km and kids. Courses share 4WD tracks and MTB trails.',
    destinations: [
      {
        name: 'Mt Buller Village',
        type: 'event_village',
        notes: 'Village Square, Summit Rd. Start/finish; the 22 km passes again at 17 km.',
      },
      {
        name: 'Mt Stirling',
        type: 'aid_station',
        courseKm: 8,
        access: '4wd',
        notes: 'At 8 km on every long course; the 45 km passes again at 18 km.',
      },
      {
        name: 'Mirimbah Park',
        type: 'aid_station',
        courseKm: 32,
        notes: '32 km on the 45 km (cutoff 1:00 pm); 23 km mark on the 36 km.',
      },
    ],
  },
  {
    code: 'kt27',
    name: 'Kilcunda Trail Running Festival 2027',
    location: 'Kilcunda, VIC',
    startDate: '2027-01-31',
    endDate: '2027-01-31',
    notes:
      '21 / 17 / 10 / 5 km along the Bass Coast. Long courses start 7:00 am, cutoff 11:00 am. ' +
      'Runners carry 500 ml; on-course drink station details not published.',
    destinations: [
      {
        name: 'Kilcunda Foreshore Village',
        type: 'event_village',
        notes: 'Start/finish for every course. 3569 Bass Hwy.',
      },
    ],
  },
  {
    code: 'sgr27',
    name: 'Snow Gum Run 2027',
    location: 'Mount Baw Baw, VIC',
    startDate: '2027-02-28',
    endDate: '2027-02-28',
    notes: 'Marathon, 35, 21, 15, 7 km and kids. Checkpoint km not published — confirm with course maps.',
    destinations: [
      {
        name: 'Village Central',
        type: 'event_village',
        notes: 'Village Central Restaurant, 32 Currawong Rd. Start/finish.',
      },
      { name: 'Five Ways', type: 'checkpoint', access: 'foot' },
      { name: 'The Camp', type: 'checkpoint', access: 'foot' },
      {
        name: 'Mt Erica Car Park',
        type: 'aid_station',
        notes: 'Marathon and 35 km, cutoff 4 h in.',
      },
      { name: 'Camp Saddle', type: 'checkpoint', access: 'foot', notes: 'Marathon cutoff 5 h in.' },
      {
        name: 'Mt St Gwinear Rd',
        type: 'aid_station',
        notes: 'Marathon cutoff 6 h in.',
      },
    ],
  },
  {
    code: 'rzb27',
    name: 'Razorback Run 2027',
    location: 'Harrietville, VIC',
    startDate: '2027-03-13',
    endDate: '2027-03-13',
    notes:
      '62 km ultra (start 5:00 am), 37 km (7:00 am), 22 km (8:00 am). Course has unmarked sections — ' +
      'runners carry GPS.',
    destinations: [
      {
        name: 'Harrietville Village',
        type: 'event_village',
        notes: 'Harrietville Hotel Motel, 169 Great Alpine Rd. 62 km and 37 km start/finish.',
      },
      {
        name: 'Razorback Trailhead',
        type: 'start',
        notes: '22 km start on the Great Alpine Rd. Limited parking; overflow at Alpine Gateway, 1.8 km walk.',
      },
      {
        name: 'The Cross Water Point',
        type: 'water_drop',
        courseKm: 10.5,
        access: 'foot',
        notes: '10.5 km on the 62/37 km; 9.5 km on the 22 km.',
      },
      { name: 'Kiewa River', type: 'checkpoint', courseKm: 19, access: 'foot', notes: '62 km only.' },
      {
        name: 'Diamantina Hut',
        type: 'aid_station',
        courseKm: 42,
        notes: 'On the Great Alpine Rd near Mt Hotham. 62 km cutoff 12 h; 22.5 km mark on the 37 km (3:00 pm).',
      },
    ],
  },
  {
    code: 'bsf27',
    name: 'Buffalo Stampede 2027',
    location: 'Bright, VIC',
    startDate: '2027-03-19',
    endDate: '2027-03-21',
    notes:
      '100 km (28 h), 42 km, 20 km, 10 km twilight, 5 km and kids from Pioneer Park. ' +
      'Station km not published — cutoff times from buffalostampede.au.',
    destinations: [
      { name: 'Pioneer Park', type: 'event_village', notes: 'Recreation Reserve, Bright. Start/finish.' },
      {
        name: 'Mystic Launch',
        type: 'aid_station',
        notes: '20 km cutoff 9:00 am; 10 km twilight 7:30 pm.',
      },
      {
        name: 'ClearSpot',
        type: 'aid_station',
        access: '4wd',
        notes: '100 km outbound 8:30 am Sat, inbound 7:30 am Sun (hot meals inbound). 42 km 3:30 pm.',
      },
      { name: 'Bakers Gully', type: 'aid_station', notes: '20 km cutoff 10:40 am; no cutoff on the 42 km.' },
      {
        name: 'Buckland Valley',
        type: 'aid_station',
        notes: '100 km outbound 10:30 am, inbound 4:40 am (hot meals inbound). 42 km 1:00 pm.',
      },
      {
        name: 'Eurobin Creek',
        type: 'aid_station',
        notes: 'Drop bags and relay changeover. 100 km outbound 12:10 pm, inbound 1:40 am. Hot meals.',
      },
      {
        name: 'Mount Buffalo Chalet',
        type: 'aid_station',
        notes: '100 km outbound 3:10 pm, inbound 10:50 pm. Hot meals. 42 km 9:20 am.',
      },
      {
        name: 'Cresta Valley',
        type: 'aid_station',
        notes: 'Drop bags and relay changeover. 100 km 5:30 pm and 7:30 pm. Hot meals.',
      },
    ],
  },
  {
    code: 'ac27',
    name: 'Alpine Challenge 2027',
    location: 'Falls Creek, VIC',
    startDate: '2027-04-03',
    endDate: '2027-04-04',
    notes:
      'Miler (42 h), 100 km (26 h), 60 km, marathon, 25 km, 10 km from Slalom Plaza. ' +
      'CHECKPOINTS BELOW ARE THE LEGACY RUNNING WILD SET — confirm against the 2027 course before planning loads.',
    destinations: [
      {
        name: 'Slalom Plaza',
        type: 'event_village',
        notes: '17 Bogong High Plains Rd, Falls Creek. Start/finish.',
      },
      {
        name: 'Warby Corner',
        type: 'checkpoint',
        access: 'foot',
        notes: 'Radio comms and first aid (legacy course).',
      },
      {
        name: 'Langfords Gap',
        type: 'aid_station',
        access: '4wd',
        notes: 'Water, refreshments, drop bags (legacy course).',
      },
      { name: 'Pole 333', type: 'checkpoint', access: 'foot', notes: 'Cutoff checkpoint (legacy course).' },
      {
        name: 'Loch Carpark',
        type: 'aid_station',
        notes: 'Mt Hotham Rd day shelter: water, soup, noodles, first aid (legacy course).',
      },
      {
        name: 'Cleve Cole Hut',
        type: 'checkpoint',
        access: 'foot',
        notes: 'Mt Bogong leg (legacy course).',
      },
    ],
  },
  {
    code: 'wp27',
    name: 'Wilsons Prom Running Festival 2027',
    location: 'Tidal River, VIC',
    startDate: '2027-05-01',
    endDate: '2027-05-02',
    notes:
      '100 / 70 / 50 / 27 / 15 / 5 km from the Commando Memorial, Tidal River. ' +
      'NO DROP BAGS at any aid station — everything walks in.',
    destinations: [
      {
        name: 'Tidal River Village',
        type: 'event_village',
        notes: 'Start/finish. The 100 km passes again at ~90 km, cutoff 3:40 am.',
      },
      {
        name: 'Telegraph Saddle',
        type: 'aid_station',
        notes: '10.6 km on the 27 km, cutoff 9:45 am.',
      },
      {
        name: 'Telegraph Junction',
        type: 'checkpoint',
        access: 'foot',
        notes: '100 km cutoff 12:45 am.',
      },
      {
        name: 'Waterloo Bay',
        type: 'checkpoint',
        access: 'foot',
        notes: '100 km passes twice: cutoffs 10:30 am and 5:30 pm (diverted south if missed).',
      },
      { name: 'Roaring Meg', type: 'checkpoint', access: 'foot', notes: '100 km cutoff 9:45 pm.' },
      { name: 'Sealers Cove', type: 'checkpoint', access: 'foot', notes: 'Out-and-back leg.' },
    ],
  },
  {
    code: 'wr27',
    name: 'Wonderland Run 2027',
    location: 'Halls Gap, VIC',
    startDate: '2027-08-28',
    endDate: '2027-08-29',
    notes:
      'PROJECTED DATE — last weekend of August, not announced yet. Stations as run in 2026 ' +
      '(WR26 Aid Station Manual): Sun 50/30/20 km, Sat 11/6 km and kids.',
    destinations: [
      {
        name: 'Halls Gap Start/Finish',
        type: 'event_village',
        notes: 'Centenary Hall, 115 Grampians Rd. All six courses, both days.',
      },
      {
        name: 'Mt Rosea Carpark',
        type: 'aid_station',
        courseKm: 13.7,
        notes: 'Sunday only. Every 50 km runner passes twice — 13.7 km and 24.5 km. Drop bags.',
      },
      {
        name: 'Wonderland Carpark',
        type: 'aid_station',
        courseKm: 12.4,
        notes: 'Sat: 11 km passes twice (3.1 and 8.6 km). Sun: 30 km at 12.4 km, 50 km at 31.9 km.',
      },
      {
        name: 'Boroka Lookout',
        type: 'aid_station',
        notes: 'Sunday only. 50, 30 and 20 km once each.',
      },
    ],
  },
];
