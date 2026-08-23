/**
 * What the old worked-example seed put in the database.
 *
 * The app used to ship a made-up demo catalogue — water cubes, energy gels,
 * three example races — so it was usable the moment it opened. That has been
 * replaced by the real SingleTrack warehouse list, but the demo is still
 * sitting in every database seeded before the change, and on the server behind
 * them. This is the list that finds it so it can be removed.
 *
 * Frozen on purpose. It was previously derived from the seed data itself, which
 * was fine while the seed was the demo — the moment the seed became the real
 * catalogue, deriving it would have pointed the removal tool at the real
 * warehouse. So it is written out here and never regenerated.
 *
 * Databases seeded after 22 August 2026 carry `demo-` ids and are matched by
 * those instead; this covers the earlier ones, which have random UUIDs.
 */

/** SKUs from the old demo catalogue. Invented codes, so a match is decisive. */
export const LEGACY_DEMO_SKUS: string[] = [
  'HYD-CUBE20', 'HYD-JERRY20', 'HYD-TW50', 'HYD-ETAB', 'HYD-JUG2', 'HYD-CUP', 'HYD-TAP',
  'NUT-GEL24', 'NUT-CHIP', 'NUT-LOLLY', 'NUT-PRTZ', 'NUT-COKE', 'NUT-BAN', 'NUT-MELON',
  'NUT-SPUD', 'AID-GAZ33', 'AID-WGT', 'AID-TBL18', 'AID-CHAIR', 'AID-ESKY60', 'AID-TARP',
  'AID-TONG', 'AID-GLOVE', 'AID-SAN', 'AID-BAG240', 'AID-BIN', 'AID-TOWEL', 'CRS-BUNT',
  'CRS-ARROW', 'CRS-FLAG', 'CRS-REFL', 'CRS-DNGR', 'CRS-PICKET', 'CRS-TIE200', 'MED-FAK',
  'MED-SNAKE', 'MED-BLNK', 'MED-AED', 'MED-SUN', 'MED-SHRP', 'COM-UHF', 'COM-BATT',
  'COM-SAT', 'PWR-GEN2', 'PWR-BANK', 'PWR-EXT15', 'COM-TORCH', 'SGN-AFRAME', 'SGN-FEATH',
  'SGN-ARCH', 'SGN-MESH3', 'TIM-MAT', 'TIM-BIB', 'TIM-CLIP',
];

export const LEGACY_DEMO_CATEGORIES: string[] = [
  'Hydration',
  'Nutrition',
  'Aid station kit',
  'Course marking',
  'Medical & safety',
  'Comms & power',
  'Signage & timing',
];

export const LEGACY_DEMO_TEMPLATES: string[] = [
  'Standard aid station (up to 200 runners)',
  'Remote station — 4WD / quad access',
  'Event village core',
  'Water-only drop',
];

/**
 * The three example races the demo created.
 *
 * These are real SingleTrack events, so a name match proves nothing about
 * whether a given record is the demo copy or the crew's own. Nothing is removed
 * on the strength of this list alone — it only decides what gets offered for a
 * person to judge.
 */
export const LEGACY_DEMO_EVENTS: string[] = [
  'Buffalo Stampede',
  'Hounslow Classic',
  'Roller Coaster Run',
];
