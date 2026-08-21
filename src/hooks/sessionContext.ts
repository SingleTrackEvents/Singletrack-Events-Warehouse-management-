import { createContext, useContext } from 'react';
import type { SyncPhase } from '../sync/engine';
import type { Session, SyncBackend } from '../sync/types';

/**
 * Session context, kept apart from the provider component so both modules stay
 * fast-refresh friendly.
 */
export interface SessionContextValue {
  backend: SyncBackend | null;
  session: Session | null;
  /** False until the stored session has been read back on startup. */
  ready: boolean;
  phase: SyncPhase;
  /** Local changes waiting to be pushed. */
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  connectDemo: () => void;
  connectServer: () => Promise<void>;
  disconnect: () => Promise<void>;
  setSession: (session: Session | null) => void;
  sync: () => Promise<void>;
  refreshPending: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  backend: null,
  session: null,
  ready: true,
  phase: 'idle',
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  connectDemo: () => {},
  connectServer: async () => {},
  disconnect: async () => {},
  setSession: () => {},
  sync: async () => {},
  refreshPending: async () => {},
});

/** Current session and sync state. Null session means offline-only mode. */
export function useSession() {
  return useContext(SessionContext);
}
