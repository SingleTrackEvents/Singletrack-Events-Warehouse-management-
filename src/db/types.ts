/**
 * Domain model for the SingleTrack Events warehouse.
 *
 * Every persisted record extends `SyncMeta`. The app is offline-first today —
 * everything lives in IndexedDB on the device — but each row already carries the
 * metadata a server would need (stable UUID, monotonic revision, updatedAt
 * timestamp, soft delete, originating device) so a sync backend can be added
 * later without migrating anyone's data.
 */

export interface SyncMeta {
  /** Stable UUID. Generated on the device, never reused. */
  id: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of the last write. Bumped by the repo layer on every save. */
  updatedAt: string;
  /** Soft delete. Rows are never hard-deleted so a future sync can tombstone. */
  deletedAt: string | null;
  /** Local revision counter, incremented on every write. */
  rev: number;
  /** Device that made the last write. Lets a future merge break ties. */
  deviceId: string;
  /** ISO timestamp of the last successful push to a server, once one exists. */
  syncedAt: string | null;
}

/* ------------------------------------------------------------------ stock -- */

/** How an item is counted. Drives the wording of steppers and count screens. */
export type Unit = 'each' | 'box' | 'carton' | 'pallet' | 'roll' | 'pack' | 'litre' | 'kg' | 'bag';

export const UNITS: Unit[] = ['each', 'box', 'carton', 'pallet', 'roll', 'pack', 'litre', 'kg', 'bag'];

export interface Category extends SyncMeta {
  name: string;
  /** Display order in pick lists and the stock screen. */
  sort: number;
  /** Emoji shown next to the category — fast visual scanning on a phone. */
  icon: string;
}

export interface Item extends SyncMeta {
  name: string;
  /** Short human code used on labels, e.g. "AS-WTR-CUBE". */
  sku: string;
  categoryId: string | null;
  unit: Unit;
  /** How many individual pieces are in one `unit` (a carton of 24 gels = 24). */
  packSize: number;
  /** Where it lives in the warehouse, e.g. "Rack B / Shelf 3". */
  bin: string;
  /** Current warehouse quantity, in `unit`s. Maintained via the movement ledger. */
  qtyOnHand: number;
  /** Reorder threshold. Below this the item shows as low stock. */
  minQty: number;
  /** Barcode value, if the item has been scanned in. */
  barcode: string | null;
  notes: string;
  /** Consumables are used up at events; assets (gazebos, radios) come back. */
  consumable: boolean;
  archived: boolean;
}

/** Why stock moved. The ledger is the audit trail behind `Item.qtyOnHand`. */
export type MovementReason =
  | 'receipt'          // stock arrived at the warehouse
  | 'issue'            // loaded out to an event
  | 'return'           // came back from an event
  | 'stocktake'        // corrected by a count
  | 'adjustment'       // manual correction
  | 'consumed'         // used at an event and not returning
  | 'damaged'          // written off
  | 'transfer';        // moved between destinations

export interface Movement extends SyncMeta {
  itemId: string;
  /** Signed quantity in the item's unit. Negative takes stock out. */
  qty: number;
  reason: MovementReason;
  /** Quantity on hand after this movement was applied. */
  balanceAfter: number;
  /** What caused it — packlist, stocktake, load. */
  refType: 'packlist' | 'stocktake' | 'load' | 'manual' | 'seed';
  refId: string | null;
  note: string;
  /** Crew member who made the movement. */
  by: string;
}

/* ----------------------------------------------------------------- events -- */

export type EventStatus = 'planning' | 'packing' | 'live' | 'debrief' | 'closed';

export const EVENT_STATUSES: EventStatus[] = ['planning', 'packing', 'live', 'debrief', 'closed'];

export interface RaceEvent extends SyncMeta {
  name: string;
  /** Region or venue, e.g. "Bright, VIC". */
  location: string;
  /** ISO date (YYYY-MM-DD) of race day. */
  startDate: string;
  /** ISO date of the final day — same as startDate for one-day events. */
  endDate: string;
  status: EventStatus;
  notes: string;
}

/** What kind of place goods are going to. Drives which templates are suggested. */
export type DestinationType =
  | 'aid_station'
  | 'event_village'
  | 'start'
  | 'finish'
  | 'checkpoint'
  | 'water_drop'
  | 'store';

export const DESTINATION_TYPES: DestinationType[] = [
  'aid_station',
  'event_village',
  'start',
  'finish',
  'checkpoint',
  'water_drop',
  'store',
];

/** How a vehicle can reach a destination — critical when planning loads. */
export type AccessType = '2wd' | '4wd' | 'atv' | 'foot' | 'helicopter';

export const ACCESS_TYPES: AccessType[] = ['2wd', '4wd', 'atv', 'foot', 'helicopter'];

export interface Destination extends SyncMeta {
  eventId: string;
  name: string;
  type: DestinationType;
  /** Distance into the course in km, used to order aid stations. */
  courseKm: number | null;
  access: AccessType;
  /** Free text: gate codes, track conditions, where to park. */
  accessNotes: string;
  lat: number | null;
  lng: number | null;
  crewLead: string;
  phone: string;
  /** Local time (HH:MM) the site must be operational. */
  openTime: string;
  closeTime: string;
  notes: string;
  sort: number;
}

/* -------------------------------------------------------------- packlists -- */

export type PacklistStatus =
  | 'draft'      // being built
  | 'picking'    // crew is pulling stock off shelves
  | 'packed'     // everything in crates, ready to load
  | 'loaded'     // on a vehicle, stock deducted from the warehouse
  | 'delivered'  // dropped at the destination
  | 'returned'   // came back to the warehouse
  | 'reconciled'; // returns counted back into stock

export const PACKLIST_STATUSES: PacklistStatus[] = [
  'draft',
  'picking',
  'packed',
  'loaded',
  'delivered',
  'returned',
  'reconciled',
];

export interface Packlist extends SyncMeta {
  eventId: string;
  destinationId: string;
  name: string;
  /** Short human code printed as a QR label, e.g. "AS3-7K2M". Unique per device. */
  code: string;
  status: PacklistStatus;
  /** Crew member who packed it. */
  packedBy: string;
  packedAt: string | null;
  deliveredAt: string | null;
  /** Name of whoever signed for it at the destination. */
  receivedBy: string;
  notes: string;
}

export interface PacklistLine extends SyncMeta {
  packlistId: string;
  itemId: string;
  /** How many the destination should receive. */
  qtyRequired: number;
  /** How many actually went in the crate. */
  qtyPacked: number;
  /** How many came back after the event. */
  qtyReturned: number;
  /** Blocks a packlist from being marked packed while short. */
  mandatory: boolean;
  /** Which crate/tub this line was packed into. */
  containerId: string | null;
  note: string;
  sort: number;
}

export type ContainerType = 'crate' | 'tub' | 'box' | 'pallet' | 'esky' | 'cage' | 'bag' | 'loose';

export const CONTAINER_TYPES: ContainerType[] = [
  'crate',
  'tub',
  'box',
  'pallet',
  'esky',
  'cage',
  'bag',
  'loose',
];

export interface Container extends SyncMeta {
  packlistId: string;
  /** Label written on the crate, e.g. "AS3-01". */
  code: string;
  type: ContainerType;
  sealed: boolean;
  notes: string;
}

/** A reusable pattern — "standard 40km aid station" — applied to new packlists. */
export interface Template extends SyncMeta {
  name: string;
  /** Destination type this template is designed for. */
  appliesTo: DestinationType;
  description: string;
}

export interface TemplateLine extends SyncMeta {
  templateId: string;
  itemId: string;
  qty: number;
  mandatory: boolean;
  /** Multiply qty by expected runner count when applying, instead of using it flat. */
  perRunner: boolean;
  note: string;
  sort: number;
}

/* -------------------------------------------------------------- stocktake -- */

export type StocktakeStatus = 'open' | 'completed' | 'cancelled';

export interface Stocktake extends SyncMeta {
  name: string;
  status: StocktakeStatus;
  /** Optional filter the count was scoped to. */
  categoryId: string | null;
  startedBy: string;
  completedAt: string | null;
  notes: string;
}

export interface StocktakeCount extends SyncMeta {
  stocktakeId: string;
  itemId: string;
  /** Quantity the system believed was on hand when the line was counted. */
  expected: number;
  /** What the crew actually counted. Null until counted. */
  counted: number | null;
  countedAt: string | null;
  countedBy: string;
  note: string;
}

/* -------------------------------------------------------------- transport -- */

export type LoadStatus = 'planned' | 'loading' | 'in_transit' | 'delivering' | 'complete' | 'cancelled';

export const LOAD_STATUSES: LoadStatus[] = [
  'planned',
  'loading',
  'in_transit',
  'delivering',
  'complete',
  'cancelled',
];

export interface Load extends SyncMeta {
  eventId: string;
  name: string;
  /** Vehicle rego or nickname, e.g. "Hilux (1AB 2CD)". */
  vehicle: string;
  driver: string;
  phone: string;
  status: LoadStatus;
  /** ISO datetime the vehicle is due to leave the warehouse. */
  departAt: string | null;
  departedAt: string | null;
  completedAt: string | null;
  notes: string;
}

export interface LoadStop extends SyncMeta {
  loadId: string;
  destinationId: string;
  sort: number;
  arrivedAt: string | null;
  /** Name of whoever took delivery on site. */
  signedBy: string;
  notes: string;
}

/* --------------------------------------------------------------- settings -- */

export interface Settings extends SyncMeta {
  orgName: string;
  /** Name stamped on movements and packlists made from this device. */
  crewName: string;
  /** Vehicles available to build loads from. */
  vehicles: string[];
  /** Crew names offered in pickers. */
  crew: string[];
  theme: 'system' | 'light' | 'dark';
  /** Whether the demo dataset has been offered/loaded. */
  seeded: boolean;
}
