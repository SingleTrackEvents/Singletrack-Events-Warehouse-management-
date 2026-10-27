import type { StationSchedule, StationWindow } from './types';

/**
 * GPT100 2026, station by station, from the Station schedule tab of
 * GPT100_VehiclePlan_2026_v1_1 (20 October 2026). First runner and cut-off
 * times are the plan's, taken from GPT_2026_Course Details; set-up and
 * pack-down are the plan's proposal. Times are local, 24 hour.
 *
 * Keyed by the station's seeded name, which is what its id is made from.
 * `title` renames a station the plan calls something else this year.
 */
export interface StationPlan {
  title?: string;
  /** Names an earlier build gave it, renamed like the seeded name if untouched. */
  formerTitles?: string[];
  vehicle: string;
  schedule: StationSchedule;
}

const window = (label: string, firstRunner: string, cutoff: string | null): StationWindow => ({
  label,
  firstRunner,
  cutoff,
});

export const GPT_PLAN_2026: Record<string, StationPlan> = {
  'Mt Zero Picnic Area': {
    title: 'Mt Zero (start line)',
    vehicle: 'STE van',
    schedule: {
      windows: [
        window('50k and Stage 1 start', '2026-11-05T06:00', null),
        window('Miler start', '2026-11-06T08:00', null),
      ],
      departsAt: '2026-11-05T03:30',
      setup:
        'Tue 08:00 to 12:00 gantry build. Thu 03:30 STE van departs Halls Gap, set-up 04:00 to 06:30. Fri 05:15 STE van departs Halls Gap, miler set-up from 06:00.',
      packDown: 'Fri gantry pack-down by 09:00 after the 08:00 miler start. All gantry gear into the STE van, back at Halls Gap about 10:00.',
      power: 'Not required (battery lights)',
      connectivity: 'Starlink Mini 1',
      units: ['Starlink Mini 1'],
    },
  },
  Coppermine: {
    title: 'Copper Mine Track (water table)',
    vehicle: 'Pantech #3',
    schedule: {
      windows: [
        window('50k / Stage 1', '2026-11-05T06:32', '2026-11-05T07:45'),
        window('Miler', '2026-11-06T08:37', '2026-11-06T09:30'),
      ],
      departsAt: '2026-11-05T05:00',
      setup: 'Thu 05:00 Pantech #3 departs Halls Gap, on site 06:00. Fri 06:45 Pantech #3 departs Halls Gap, on site 07:45.',
      packDown:
        'Thu after the 07:45 cut-off, back at Halls Gap about 09:30. Fri 09:30, back at Halls Gap by 11:00, then loads Jimmy Creek drop bags.',
      power: 'Not needed',
      connectivity: 'Starlink Mini 2',
      units: ['Starlink Mini 2'],
    },
  },
  'GAR Trailhead': {
    vehicle: 'Pantech #1',
    schedule: {
      windows: [
        window('50k / Stage 1', '2026-11-05T07:15', '2026-11-05T10:00'),
        window('Miler', '2026-11-06T09:26', '2026-11-06T12:00'),
      ],
      departsAt: '2026-11-05T04:30',
      setup: 'Thu 04:30 Pantech #1 departs Halls Gap, set up by 06:15. Fri 07:00 Pantech #1 departs Halls Gap, reopen, set up by 08:30.',
      packDown:
        'Thu after the 10:00 cut-off, Pantech #1 back to Halls Gap overnight to restock. Fri 12:00 to 13:00, back at Halls Gap 14:00, reload for Cassidys and Bainggug.',
      power: 'Not required',
      connectivity: 'Starlink Mini 3',
      units: ['Starlink Mini 3'],
    },
  },
  'Mt Difficult Ridgeline': {
    title: 'Ridgeline water point (Long Point)',
    vehicle: "None (Simon's own vehicle, walk in)",
    schedule: {
      windows: [
        window('50k / Stage 1', '2026-11-05T08:45', '2026-11-05T15:00'),
        window('Miler', '2026-11-06T10:56', '2026-11-06T16:30'),
      ],
      departsAt: null,
      setup: 'Simon drives to the trailhead in his own vehicle and walks in. Water drop beforehand (day to be confirmed).',
      packDown: 'Walk out after the cut-off each day.',
      power: 'Not needed',
      connectivity: '5G (mobile)',
    },
  },
  'Mt Difficult Rd': {
    vehicle: 'Van #1',
    schedule: {
      windows: [
        window('50k / Stage 1', '2026-11-05T09:05', '2026-11-05T16:00'),
        window('Miler', '2026-11-06T11:34', '2026-11-06T17:00'),
      ],
      departsAt: '2026-11-05T06:30',
      setup: 'Thu 06:30 Van #1 departs Halls Gap, set up by 08:00. Fri 09:00 Van #1 departs Halls Gap, reopen, set up by 10:30.',
      packDown:
        'Thu after the 16:00 cut-off, Van #1 back to Halls Gap overnight to restock. Fri 17:00 to 18:00 in daylight, back at Halls Gap about 19:30, then departs about 21:00 for Bainggug as the parked vehicle.',
      power: 'EcoFlow #1',
      connectivity: 'Starlink 2',
      units: ['EcoFlow #1', 'Starlink 2'],
    },
  },
  'Halls Gap': {
    // "Halls Gap (village)" sat next to "Halls Gap Event Village" on the board
    // and a volunteer could not tell which was the aid station.
    title: 'Halls Gap aid station',
    formerTitles: ['Halls Gap (village)'],
    vehicle: 'STE van (static village)',
    schedule: {
      windows: [
        window('50k / Stage 1 finish', '2026-11-05T10:05', '2026-11-05T19:00'),
        window('Stage 2 start', '2026-11-06T05:50', null),
        window('Miler', '2026-11-06T12:49', '2026-11-06T20:00'),
      ],
      departsAt: null,
      setup: 'Mon 12:00 hire vehicles on site for loading. Thu 09:00 STE van back from Mt Zero.',
      packDown: 'Fri 20:00 cut-off, STE van relocates to Dunkeld Friday evening.',
      power: 'Village power',
      connectivity: 'Starlink 1',
      units: ['Starlink 1'],
    },
  },
  'Rosea Carpark': {
    vehicle: 'Van #2',
    schedule: {
      windows: [
        window('Stage 2', '2026-11-06T06:40', '2026-11-06T08:50'),
        window('Miler', '2026-11-06T14:06', '2026-11-06T23:00'),
      ],
      departsAt: '2026-11-06T04:45',
      setup: 'Fri 04:45 Van #2 departs Halls Gap, set up by 06:00.',
      packDown: 'Fri 23:00 to 00:00, back at Halls Gap about 00:30 Sat.',
      power: 'EcoFlow #2',
      connectivity: 'Starlink 3',
      units: ['EcoFlow #2', 'Starlink 3'],
    },
  },
  'Borough Huts': {
    vehicle: 'Van #3',
    schedule: {
      windows: [
        window('Stage 2', '2026-11-06T07:40', '2026-11-06T12:20'),
        window('Miler', '2026-11-06T15:31', '2026-11-07T02:15'),
      ],
      departsAt: '2026-11-06T05:30',
      setup: 'Fri 05:30 Van #3 departs Halls Gap, set up by 07:00.',
      packDown: 'Sat 02:15 to 03:30, back at Halls Gap about 04:00.',
      power: 'Generator (hired)',
      connectivity: 'Starlink 4',
      units: ['Generator (hired)', 'Starlink 4'],
    },
  },
  'Seven Dials Track': {
    title: 'Seven Dials Track (safety marshal)',
    vehicle: "None (marshal's own vehicle)",
    schedule: {
      windows: [
        window('Stage 2', '2026-11-06T08:50', '2026-11-06T15:20'),
        window('Miler', '2026-11-06T16:43', '2026-11-07T05:15'),
      ],
      departsAt: null,
      setup: 'One safety marshal. No aid station, no vehicle allocation.',
      packDown: '',
      power: 'Not needed',
      connectivity: 'Mobile (known OK)',
    },
  },
  'Mt William Carpark': {
    vehicle: 'Pantech #2',
    schedule: {
      windows: [
        window('Stage 2 finish', '2026-11-06T09:20', '2026-11-06T18:00'),
        window('Miler', '2026-11-06T17:52', '2026-11-07T08:15'),
        window('Stage 3 start', '2026-11-07T06:00', null),
      ],
      departsAt: '2026-11-06T07:00',
      setup: 'Fri 07:00 Pantech #2 departs Halls Gap, set up by 08:30.',
      packDown: 'Sat 08:15 to 10:30, back at Halls Gap about 11:30.',
      power: 'Light tower',
      connectivity: 'Starlink 5',
      units: ['Light tower 1', 'Starlink 5'],
    },
  },
  'Stockyard Track': {
    title: 'Stockyard Track (safety checkpoint)',
    vehicle: "Ray Taylor's 4WD",
    schedule: {
      windows: [
        window('Miler', '2026-11-06T19:52', '2026-11-07T12:45'),
        window('Stage 3', '2026-11-07T07:40', '2026-11-07T10:30'),
      ],
      departsAt: '2026-11-06T17:00',
      setup: "Fri 17:00 Ray Taylor's 4WD departs Halls Gap with the Stockyard kit, set up by 19:00.",
      packDown: 'Sat 12:45 to 13:15, return to Halls Gap.',
      power: 'Not needed',
      connectivity: 'Starlink Mini 2',
    },
  },
  'Jimmy Creek Rd': {
    title: 'Jimmy Creek Campground',
    vehicle: 'Pantech #3',
    schedule: {
      windows: [
        window('Miler', '2026-11-06T20:27', '2026-11-07T14:30'),
        window('Stage 3', '2026-11-07T07:55', '2026-11-07T12:00'),
      ],
      departsAt: '2026-11-06T16:30',
      setup: 'Fri 16:30 Pantech #3 departs Halls Gap, set up by 19:00.',
      packDown: 'Sat 14:30 to 16:00, then to Dunkeld or Halls Gap.',
      power: 'Light tower',
      connectivity: 'Starlink Mini 1',
      units: ['Light tower 2', 'Starlink Mini 1'],
    },
  },
  'Yarram Gap Rd': {
    title: 'Yarram Gap Rd (emergency aid station)',
    vehicle: 'Set up by Pantech #4, collected by Van #2',
    schedule: {
      windows: [
        window('Miler', '2026-11-06T22:10', '2026-11-07T18:30'),
        window('Stage 3', '2026-11-07T08:45', '2026-11-07T15:00'),
      ],
      departsAt: '2026-11-06T16:30',
      setup:
        'Fri 16:30 Pantech #4 departs Halls Gap with tent, water, glucose, salts, timing kit and Starlink Mini 3. Set up about 17:10 to 18:00, then on to Griffin.',
      packDown: 'Sat after the 18:30 cut-off, Van #2 collects about 19:30, back at Halls Gap about 20:30.',
      power: 'EcoFlow #1, on from Mt Difficult Rd after its Friday cut-off',
      connectivity: 'Starlink Mini 3',
      units: ['EcoFlow #1', 'Starlink Mini 3'],
    },
  },
  'Griffin Fireline': {
    vehicle: 'Pantech #4',
    schedule: {
      windows: [
        window('Miler', '2026-11-06T23:53', '2026-11-07T22:15'),
        window('Stage 3 finish', '2026-11-07T09:40', '2026-11-07T18:00'),
        window('Stage 4 start', '2026-11-08T07:00', null),
      ],
      departsAt: '2026-11-06T16:30',
      setup: 'Fri 16:30 Pantech #4 departs Halls Gap with drop bags, sets up Yarram Gap on the way, on site about 18:45, set up by 21:30.',
      packDown: 'Sat 22:15 overnight pack-down to a start-line set-up. Sun 07:00 start, pack down 07:30 to 09:00, then to Dunkeld or Halls Gap.',
      power: 'Light tower',
      connectivity: 'Starlink 2',
      units: ['Light tower 3'],
    },
  },
  'Cassidys Gap': {
    title: 'Cassidys Gap Rd',
    vehicle: 'Pantech #1',
    schedule: {
      windows: [
        window('Miler', '2026-11-07T01:28', '2026-11-08T02:00'),
        window('Stage 4', '2026-11-08T07:20', '2026-11-08T10:00'),
      ],
      departsAt: '2026-11-06T20:30',
      setup: 'Fri 20:30 Pantech #1 departs Halls Gap loaded for Cassidys and Bainggug, Cassidys set up by 00:30.',
      packDown: 'Sun 10:00 to 11:00, then Pantech #1 moves to the Bainggug pack-down.',
      power: 'Generator (2.3kVA), and the large hired generator on from Borough Huts',
      connectivity: 'Starlink 3, on from Rosea Carpark',
      units: ['Starlink 3'],
    },
  },
  'Bainggug Carpark': {
    vehicle: 'Pantech #1 delivers, Van #1 parked',
    schedule: {
      windows: [
        window('Miler', '2026-11-07T03:23', '2026-11-08T06:30'),
        window('Stage 4', '2026-11-08T08:30', '2026-11-08T13:30'),
      ],
      departsAt: '2026-11-06T21:00',
      setup: 'Fri 21:00 Van #1 departs Halls Gap as the parked vehicle. Sat 00:30 Pantech #1 continues from Cassidys, set up by 02:30.',
      packDown: 'Sun 13:30 to 14:30, back at Halls Gap about 16:00.',
      power: 'Generator (2.3kVA)',
      connectivity: 'Starlink 4, on from Borough Huts',
      units: ['Starlink 4'],
    },
  },
  'Dunkeld Finish': {
    title: 'Dunkeld (finish line)',
    vehicle: 'STE van',
    schedule: {
      windows: [
        window('Miler finish', '2026-11-07T04:47', '2026-11-08T10:00'),
        window('5k Family Race', '2026-11-08T07:30', '2026-11-08T09:00'),
        window('2k Kids Race', '2026-11-08T08:30', '2026-11-08T09:30'),
        window('Stage 4 / 33k finish', '2026-11-08T09:20', '2026-11-08T17:00'),
      ],
      departsAt: '2026-11-06T20:30',
      setup: 'Fri 20:30 STE van departs Halls Gap with the gantry gear, on site 21:30, set up by 23:30.',
      packDown: 'Sun 17:00 to 19:00, STE van returns to Halls Gap for presentations.',
      power: 'Village power',
      connectivity: 'Starlink 1',
    },
  },
};
