import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  Category,
  Container,
  Destination,
  Item,
  Load,
  LoadStop,
  Movement,
  Packlist,
  PacklistLine,
  RaceEvent,
  Settings,
  Stocktake,
  StocktakeCount,
  SyncMeta,
  Template,
  TemplateLine,
} from './types';

const DEVICE_KEY = 'stw.deviceId';

/** A stable per-device identifier, so a future sync can attribute writes. */
export function deviceId(): string {
  if (typeof localStorage === 'undefined') return 'test-device';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** UUID v4, falling back to a random string where crypto.randomUUID is missing. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Fresh sync metadata for a brand new record. */
export function stampNew(): SyncMeta {
  const at = nowIso();
  return {
    id: newId(),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    rev: 1,
    deviceId: deviceId(),
    syncedAt: null,
  };
}

/** Bump the sync metadata of an existing record ahead of a write. */
export function stampUpdate<T extends SyncMeta>(record: T): T {
  return {
    ...record,
    updatedAt: nowIso(),
    rev: record.rev + 1,
    deviceId: deviceId(),
    syncedAt: null,
  };
}

export class WarehouseDb extends Dexie {
  categories!: Table<Category, string>;
  items!: Table<Item, string>;
  movements!: Table<Movement, string>;
  events!: Table<RaceEvent, string>;
  destinations!: Table<Destination, string>;
  packlists!: Table<Packlist, string>;
  packlistLines!: Table<PacklistLine, string>;
  containers!: Table<Container, string>;
  templates!: Table<Template, string>;
  templateLines!: Table<TemplateLine, string>;
  stocktakes!: Table<Stocktake, string>;
  stocktakeCounts!: Table<StocktakeCount, string>;
  loads!: Table<Load, string>;
  loadStops!: Table<LoadStop, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'singletrack-warehouse') {
    super(name);
    // `deletedAt` is indexed on every table so live queries can cheaply filter
    // out tombstones without scanning.
    this.version(1).stores({
      categories: 'id, name, sort, deletedAt, updatedAt',
      items: 'id, name, sku, categoryId, barcode, archived, deletedAt, updatedAt',
      movements: 'id, itemId, reason, refType, refId, createdAt, deletedAt, updatedAt',
      events: 'id, name, startDate, status, deletedAt, updatedAt',
      destinations: 'id, eventId, type, sort, deletedAt, updatedAt',
      packlists: 'id, code, eventId, destinationId, status, deletedAt, updatedAt',
      packlistLines: 'id, packlistId, itemId, containerId, sort, deletedAt, updatedAt',
      containers: 'id, packlistId, code, deletedAt, updatedAt',
      templates: 'id, name, appliesTo, deletedAt, updatedAt',
      templateLines: 'id, templateId, itemId, sort, deletedAt, updatedAt',
      stocktakes: 'id, status, createdAt, deletedAt, updatedAt',
      stocktakeCounts: 'id, stocktakeId, itemId, deletedAt, updatedAt',
      loads: 'id, eventId, status, departAt, deletedAt, updatedAt',
      loadStops: 'id, loadId, destinationId, sort, deletedAt, updatedAt',
      settings: 'id, updatedAt',
    });
  }
}

export const db = new WarehouseDb();

/** Every table, for whole-database operations like backup and wipe. */
export const ALL_TABLES = [
  'categories',
  'items',
  'movements',
  'events',
  'destinations',
  'packlists',
  'packlistLines',
  'containers',
  'templates',
  'templateLines',
  'stocktakes',
  'stocktakeCounts',
  'loads',
  'loadStops',
  'settings',
] as const;

export type TableName = (typeof ALL_TABLES)[number];

export const SETTINGS_ID = 'settings';

export function defaultSettings(): Settings {
  return {
    ...stampNew(),
    id: SETTINGS_ID,
    orgName: 'SingleTrack Events',
    crewName: '',
    vehicles: ['Hilux', 'Troopy', '6m Truck', 'Trailer'],
    crew: [],
    theme: 'system',
    seeded: false,
  };
}

/** Read settings, creating the singleton row on first run. */
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get(SETTINGS_ID);
  if (existing) return existing;
  const fresh = defaultSettings();
  await db.settings.put(fresh);
  return fresh;
}
