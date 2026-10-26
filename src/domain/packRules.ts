import type { DestinationType, Item, PacklistLine } from '../db/types';

/**
 * Pack rules: what usually travels with what.
 *
 * A marquee never goes out alone. It needs its ratchet straps, its steel
 * weights and, at an aid station, its walls, and the crew has always worked
 * those out by hand from the marquee count. These rules do the sum, for every
 * event, and the packlist offers what is missing with one tap. Nothing is
 * added without someone saying so: a rule is the usual case, and the crew
 * knows when this one is not.
 *
 * Quantities come from the RCR26 Aid Station Cards, which spell most of
 * them out ("every marquee gets 1 steel weight on each leg and 4 ratchet
 * straps"); table cloths follow the GPT100 2026 Master Pack List. Items are named by
 * catalogue SKU, so renaming an item in the app does not break a rule.
 */

export interface Companion {
  sku: string;
  /** How many per one of the trigger item. */
  per?: number;
  /** A floor, whatever the trigger count, for things one of does the lot. */
  atLeast?: number;
  /** Destination types where this companion is not asked for. */
  notAt?: DestinationType[];
  /** Event ids where this companion is not asked for, for one year's change of plan. */
  notEvents?: string[];
  /** Other items that do its job: with any of them on the list, it is not asked for. */
  orAny?: string[];
}

export interface PackRule {
  id: string;
  /** What sets the rule off: an item on the list, or the kind of destination. */
  when: { sku: string } | { destination: DestinationType | DestinationType[] };
  /** Destination types the whole rule stays out of. */
  notAt?: DestinationType[];
  /** Event ids the rule is kept to. Absent is every event. */
  events?: string[];
  /** Said back to the crew alongside the suggestion. */
  why: string;
  add: Companion[];
}

export const PACK_RULES: PackRule[] = [
  {
    id: 'marquee',
    when: { sku: 'STR-02' }, // Marquee - ST 3x3
    why: '4 ratchet straps and 4 steel weights per marquee (1 per leg, 2 if windy), and 2 walls at an aid station',
    add: [
      { sku: 'ANC-01', per: 4 }, // Ratchet Straps
      { sku: 'ANC-03', per: 4 }, // Weights - Steel 20kg, 1 per leg
      // The village sets its walls by layout, not by marquee count.
      { sku: 'STR-01', per: 2, notAt: ['event_village'] }, // Marquee Walls
    ],
  },
  {
    // From the GPT100 2026 Master Pack List: cloths follow the marquees, not
    // the tables, since a station's spare trestles stay folded.
    id: 'table-cloth',
    when: { sku: 'STR-02' }, // Marquee - ST 3x3
    why: '3 table cloths for every 2 marquees',
    add: [{ sku: 'FRN-03', per: 1.5 }], // Table Cloths
  },
  {
    id: 'hired-structure-cloths',
    when: { sku: 'STR-90' }, // Hired Structure (Prestige Hire)
    why: 'at least 3 table cloths under a hired structure',
    add: [{ sku: 'FRN-03', atLeast: 3 }], // Table Cloths
  },
  {
    id: 'gpt-village-cloths',
    when: { destination: 'event_village' },
    // The seeded GPT100 2026 event: 16 trestle tables at the Halls Gap village.
    events: ['stw-event-gpt26'],
    why: 'the GPT100 village holds at least 12 table cloths',
    add: [{ sku: 'FRN-03', atLeast: 12 }], // Table Cloths
  },
  {
    id: 'ibc-pipe',
    when: { sku: 'WAT-07' }, // IBC Water Container (1000L)
    why: 'each IBC travels with its pipe as a matched set',
    add: [{ sku: 'WAT-06', per: 1 }], // IBC Pipe
  },
  {
    id: 'umbrella-base',
    when: { sku: 'VIL-07' }, // ASICS Umbrellas
    why: 'one base per umbrella',
    add: [{ sku: 'VIL-08', per: 1 }], // Umbrella Bases
  },
  {
    id: 'arch-pump',
    when: { sku: 'VIL-13' }, // Inflatable Arch
    why: 'an inflatable needs a pump',
    add: [{ sku: 'VIL-09', atLeast: 1 }], // Inflatable Arch Pump
  },
  {
    id: 'pillar-pump',
    when: { sku: 'FRN-08' }, // Inflatable Pillar
    why: 'an inflatable needs a pump',
    add: [{ sku: 'VIL-09', atLeast: 1 }],
  },
  {
    id: 'generator',
    when: { sku: 'PWR-06' }, // Generator
    // Village generators are hired and run by the site crew.
    notAt: ['event_village'],
    why: 'a generator needs an RCD, a full jerry can, a power board and a 2m and 5m lead',
    add: [
      { sku: 'PWR-91', per: 1 }, // RCD (Portable Safety Switch)
      { sku: 'PWR-11', per: 1 }, // Jerry Can (Fuel)
      { sku: 'PWR-04', per: 1 }, // Power Board
      { sku: 'PWR-01', per: 1 }, // Electrical Power Cable (2-3m)
      { sku: 'PWR-10', per: 1 }, // Extension Cable (5m+)
    ],
  },
  {
    id: 'power-board-cover',
    when: { sku: 'PWR-04' }, // Power Board
    why: 'a wet weather cover on every join',
    add: [{ sku: 'PWR-90', per: 1 }], // Wet Weather Electrical Covers
  },
  {
    id: 'night-station',
    when: { sku: 'LGT-07' }, // Stand Light
    notAt: ['event_village'],
    why: 'a lit station needs strip lights and a generator to run them',
    add: [
      { sku: 'LGT-02', atLeast: 1 }, // Strip Light
      { sku: 'PWR-06', atLeast: 1 }, // Generator
    ],
  },
  {
    id: 'ice-eskies',
    when: { sku: 'FD-02' }, // Ice
    why: 'drinks ice and cooling ice kept in separate eskies',
    add: [{ sku: 'WAT-03', atLeast: 2 }], // Esky / Cooler
  },
  {
    id: 'printer',
    when: { sku: 'REG-14' }, // Printer
    why: 'a printer needs a spare ink pack and paper',
    add: [
      { sku: 'REG-15', atLeast: 1 }, // Printer Ink
      { sku: 'REG-11', atLeast: 2 }, // Paper (packs)
    ],
  },
  {
    id: 'gas-stove',
    when: { sku: 'CKG-02' }, // Gas Stove
    why: 'a gas stove needs its bottle, a lighter and 2 stove-top kettles',
    add: [
      { sku: 'CKG-01', per: 1 }, // Gas Bottle
      { sku: 'CKG-90', per: 1 }, // Lighter
      { sku: 'CKG-03', per: 2 }, // Kettle - Stove Top
    ],
  },
  {
    id: 'gas-heater',
    when: { sku: 'CKG-07' }, // Gas Heater
    why: 'a gas heater needs its own bottle, on top of the stove\'s',
    add: [{ sku: 'CKG-01', per: 1 }], // Gas Bottle
  },
  {
    id: 'nap-bed',
    when: { sku: 'MED-02' }, // Camp Stretcher / Folding Bed
    why: '3 blankets per nap bed',
    add: [{ sku: 'MED-01', per: 3 }], // Blankets / Space Blankets
  },
  {
    id: 'flags',
    when: { sku: 'OTH-02' }, // International / Participant / Presentation Flags
    why: 'every flag goes up on a pole, with a soccer cone for a base',
    add: [
      { sku: 'OTH-03', per: 1 }, // Flag Poles
      { sku: 'CRS-90', per: 1 }, // Soccer Cones
    ],
  },
  {
    id: 'gpt-starlink',
    when: { destination: ['aid_station', 'start', 'finish'] },
    // The seeded GPT100 2026 event. No phone reception on most of that course.
    events: ['stw-event-gpt26'],
    why: 'every GPT100 station runs a Starlink',
    add: [{ sku: 'COM-01', atLeast: 1, orAny: ['COM-90'] }], // Starlink, or a Starlink Mini
  },
  {
    id: 'aid-station-basics',
    when: { destination: 'aid_station' },
    why: 'every staffed aid station',
    add: [
      { sku: 'KIT-01', atLeast: 1 }, // Primary Aid Station Kit
      // No black bins at GPT100 2026: bin bags hang from the tents instead.
      { sku: 'WST-01', atLeast: 2, notEvents: ['stw-event-gpt26'] }, // Bins - Large Round Black
      { sku: 'FRN-06', atLeast: 2 }, // Chairs - Camping / Folding
      { sku: 'FRN-04', atLeast: 2 }, // Tarps
      { sku: 'COM-03', atLeast: 1 }, // Bluetooth Speaker
    ],
  },
];

export interface Suggestion {
  item: Item;
  /** How many more to add. */
  qty: number;
  /** What the rules call for in total. */
  need: number;
  /** Already on the list. */
  have: number;
  /** One line per rule that asked, e.g. "3 × Marquee: 4 ratchet straps …". */
  because: string[];
  /** Key for remembering a "not needed": the item and the amount asked. */
  key: string;
}

/**
 * What the rules say is missing from a list.
 *
 * Quantities chain: a generator asks for a power board, and that power board
 * asks for its cover, so the cover is suggested before the board is even on
 * the list. Each companion's need is the sum of its `per` amounts, or its
 * largest `atLeast` floor, whichever is more; only the shortfall against what
 * the list already carries is offered.
 */
export function suggestionsFor(
  lines: PacklistLine[],
  items: Map<string, Item>,
  destinationType: DestinationType | undefined,
  eventId?: string,
  rules: PackRule[] = PACK_RULES,
): Suggestion[] {
  const bySku = new Map<string, Item>();
  for (const item of items.values()) if (!item.deletedAt && !item.archived) bySku.set(item.sku, item);

  const have = new Map<string, number>();
  for (const line of lines) {
    if (line.deletedAt) continue;
    const sku = items.get(line.itemId)?.sku;
    if (sku) have.set(sku, (have.get(sku) ?? 0) + line.qtyRequired);
  }

  const applies = (notAt?: DestinationType[]) => !destinationType || !notAt?.includes(destinationType);

  let need = new Map<string, number>();
  let reasons = new Map<string, string[]>();
  // A few rounds settle any chain; the rules are shallow, so this is bounded.
  for (let round = 0; round < 5; round++) {
    const count = (sku: string) => Math.max(have.get(sku) ?? 0, need.get(sku) ?? 0);
    const perSum = new Map<string, number>();
    const floor = new Map<string, number>();
    const why = new Map<string, string[]>();
    for (const rule of rules) {
      if (!applies(rule.notAt)) continue;
      if (rule.events && (!eventId || !rule.events.includes(eventId))) continue;
      let trigger: number;
      let label: string;
      if ('sku' in rule.when) {
        trigger = count(rule.when.sku);
        label = `${trigger} × ${bySku.get(rule.when.sku)?.name ?? rule.when.sku}`;
      } else {
        const types = ([] as DestinationType[]).concat(rule.when.destination);
        trigger = destinationType && types.includes(destinationType) ? 1 : 0;
        label = types.length === 1 && types[0] === 'aid_station' ? 'Aid station' : 'This station';
      }
      if (trigger <= 0) continue;
      for (const companion of rule.add) {
        if (!applies(companion.notAt) || !bySku.has(companion.sku)) continue;
        if (eventId && companion.notEvents?.includes(eventId)) continue;
        if (companion.orAny?.some((sku) => (have.get(sku) ?? 0) > 0)) continue;
        if (companion.per) {
          perSum.set(companion.sku, (perSum.get(companion.sku) ?? 0) + trigger * companion.per);
        }
        if (companion.atLeast) {
          floor.set(companion.sku, Math.max(floor.get(companion.sku) ?? 0, companion.atLeast));
        }
        why.set(companion.sku, [...(why.get(companion.sku) ?? []), `${label}: ${rule.why}`]);
      }
    }
    const next = new Map<string, number>();
    for (const sku of new Set([...perSum.keys(), ...floor.keys()])) {
      next.set(sku, Math.ceil(Math.max(perSum.get(sku) ?? 0, floor.get(sku) ?? 0)));
    }
    const settled = next.size === need.size && [...next].every(([sku, qty]) => need.get(sku) === qty);
    need = next;
    reasons = why;
    if (settled) break;
  }

  const suggestions: Suggestion[] = [];
  for (const [sku, qty] of need) {
    const onList = have.get(sku) ?? 0;
    if (qty <= onList) continue;
    const item = bySku.get(sku)!;
    suggestions.push({
      item,
      qty: qty - onList,
      need: qty,
      have: onList,
      because: [...new Set(reasons.get(sku) ?? [])],
      key: `${item.id}:${qty}`,
    });
  }
  return suggestions.sort((a, b) => a.item.name.localeCompare(b.item.name));
}
