import { MockBackend } from './mock';
import type { SyncBackend } from './types';

/**
 * Backend selection.
 *
 * Only the on-device demo server exists today. When a hosted backend is wired
 * up it registers here and everything above this file — screens, engine,
 * permission checks — carries on unchanged.
 */

let active: SyncBackend | null = null;

/** The backend in use, or null when the app is in offline-only mode. */
export function getBackend(): SyncBackend | null {
  return active;
}

export function setBackend(backend: SyncBackend | null): void {
  active = backend;
}

/** Turn on the stand-in server so the sync and access flows can be exercised. */
export function connectDemoBackend(): SyncBackend {
  active = new MockBackend();
  return active;
}

export const BACKEND_ENABLED_KEY = 'stw.sync.enabled';

/** Restore whatever backend the device was last using. */
export function restoreBackend(): SyncBackend | null {
  if (typeof localStorage === 'undefined') return null;
  if (localStorage.getItem(BACKEND_ENABLED_KEY) === 'demo') return connectDemoBackend();
  return null;
}

export * from './types';
export { can, canEditField, describeRole, roleAtLeast } from './permissions';
