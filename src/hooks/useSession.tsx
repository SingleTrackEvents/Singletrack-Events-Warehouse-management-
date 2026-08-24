import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BACKEND_ENABLED_KEY,
  connectDemoBackend,
  connectSupabase,
  getBackend,
  restoreBackend,
  setBackend,
} from '../sync';
import { SessionContext } from './sessionContext';
import type { SessionContextValue } from './sessionContext';
import { getLastSync, markAllDirty, pendingCount, resetCursor, runSync } from '../sync/engine';
import type { SyncPhase } from '../sync/engine';
import { setCurrentSession } from '../sync/current';
import type { Session, SyncBackend } from '../sync/types';

/** How often to sync while the app is open and online. */
const SYNC_INTERVAL_MS = 45_000;

/**
 * Session and sync state for the whole app.
 *
 * When no backend is connected this stays empty and every permission check
 * passes, so the app behaves exactly as it did before sync existed — one
 * device, no accounts, nothing to sign into.
 */

export function SessionProvider({ children }: { children: ReactNode }) {
  const [backend, setBackendState] = useState<SyncBackend | null>(null);
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [pending, setPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(getLastSync());
  const [lastError, setLastError] = useState<string | null>(null);
  // Guards against overlapping sync runs.
  const syncing = useRef(false);

  // Mirrored outside React so the repository helpers can apply the same
  // permission rules the screens do; see sync/current.ts.
  useEffect(() => {
    setCurrentSession(session);
  }, [session]);

  // Restore the connection and session from the last time the app was open.
  useEffect(() => {
    void (async () => {
      const restored = restoreBackend();
      setBackendState(restored);
      if (restored) setSessionState(await restored.currentSession());
      setPending(await pendingCount());
      setReady(true);
    })();
  }, []);

  const refreshPending = useCallback(async () => {
    setPending(await pendingCount(getBackend() ? session : null));
  }, [session]);

  const sync = useCallback(async () => {
    const current = getBackend();
    if (!current || !session) return;
    // A slow sync must not have a second one pile in behind it, or the same
    // rows get pushed twice and the phase indicator flickers.
    if (syncing.current) return;
    syncing.current = true;
    setLastError(null);
    try {
      await runSync(current, session, setPhase);
      setLastSyncAt(getLastSync());
    } catch (cause) {
      setPhase('error');
      setLastError(cause instanceof Error ? cause.message : 'Sync failed.');
    } finally {
      syncing.current = false;
      await refreshPending();
    }
  }, [session, refreshPending]);

  const connectDemo = useCallback(() => {
    const created = connectDemoBackend();
    localStorage.setItem(BACKEND_ENABLED_KEY, 'demo');
    setBackendState(created);
  }, []);

  const connectServer = useCallback(async () => {
    const created = connectSupabase();
    localStorage.setItem(BACKEND_ENABLED_KEY, 'supabase');
    setBackendState(created);
    // Following an email link lands back here with a session already live.
    setSessionState(await created.currentSession());
  }, []);

  const disconnect = useCallback(async () => {
    await getBackend()?.signOut();
    setBackend(null);
    localStorage.removeItem(BACKEND_ENABLED_KEY);
    resetCursor();
    setBackendState(null);
    setSessionState(null);
    setLastSyncAt(null);
  }, []);

  const applySession = useCallback((next: Session | null) => {
    setSessionState(next);
    if (next) {
      // Anything already on this device predates the account, so queue it all.
      void markAllDirty().then(() => refreshPending());
    }
  }, [refreshPending]);

  /**
   * Keep the two devices in step.
   *
   * Syncing only once after sign-in was not enough: everything the crew did
   * afterwards sat in the outbox until the app was reloaded. So it also runs on
   * a timer, when the connection comes back, and whenever the app returns to
   * the foreground — which on a phone is the moment that actually matters,
   * since the app is backgrounded between every job.
   */
  useEffect(() => {
    if (!backend || !session) return;

    const attempt = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void sync();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') attempt();
    };

    const first = setTimeout(attempt, 800);
    const timer = setInterval(attempt, SYNC_INTERVAL_MS);
    window.addEventListener('online', attempt);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener('online', attempt);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [backend, session, sync]);

  const value = useMemo<SessionContextValue>(
    () => ({
      backend, session, ready, phase, pending, lastSyncAt, lastError,
      connectDemo, connectServer, disconnect, setSession: applySession, sync, refreshPending,
    }),
    [backend, session, ready, phase, pending, lastSyncAt, lastError,
     connectDemo, connectServer, disconnect, applySession, sync, refreshPending],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
