import { MockBackend } from './mock';
import { SUPABASE_CONFIGURED, SUPABASE_KEY, SUPABASE_URL } from './config';
import { SupabaseBackend } from './supabase';
import type { SyncBackend } from './types';

/**
 * Backend selection.
 *
 * Three states: nothing connected (the app is offline-only, exactly as it began),
 * the on-device demo server, or the real hosted project. Everything above this
 * file works the same against all three.
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

/** Connect the real hosted project. */
export function connectSupabase(): SyncBackend {
  if (!SUPABASE_CONFIGURED) {
    throw new Error('No Supabase project is configured for this build.');
  }
  active = new SupabaseBackend(SUPABASE_URL, SUPABASE_KEY);
  return active;
}

export const BACKEND_ENABLED_KEY = 'stw.sync.enabled';

/** Restore whatever backend the device was last using. */
export function restoreBackend(): SyncBackend | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(BACKEND_ENABLED_KEY);
  if (stored === 'supabase' && SUPABASE_CONFIGURED) return connectSupabase();
  if (stored === 'demo') return connectDemoBackend();
  return null;
}

export { SUPABASE_CONFIGURED } from './config';
export * from './types';
export { can, canEditField, describeRole, roleAtLeast } from './permissions';
