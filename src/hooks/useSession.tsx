import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { Session, SyncBackend } from '../sync/types';

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
    setLastError(null);
    try {
      await runSync(current, session, setPhase);
      setLastSyncAt(getLastSync());
    } catch (cause) {
      setPhase('error');
      setLastError(cause instanceof Error ? cause.message : 'Sync failed.');
    } finally {
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

  // Sync when a connection returns, and shortly after signing in.
  useEffect(() => {
    if (!backend || !session) return;
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    const timer = setTimeout(() => void sync(), 800);
    return () => {
      window.removeEventListener('online', onOnline);
      clearTimeout(timer);
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
