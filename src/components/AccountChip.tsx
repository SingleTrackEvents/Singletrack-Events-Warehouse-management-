import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/sessionContext';
import { initials } from '../domain/format';

/**
 * Who you are and whether your work is safe, on every screen.
 *
 * Buried in a settings page, this was the wrong information in the wrong place:
 * "am I signed in, as whom, and has my packing actually left this phone" is a
 * question people ask constantly and cannot afford to guess at on race morning.
 * The dot carries the sync state so it reads at a glance without being loud.
 */
export function AccountChip() {
  const navigate = useNavigate();
  const { backend, session, pending, phase } = useSession();

  // Offline-only mode has no account, so there is nothing honest to show.
  if (!backend) return null;

  const state = !session
    ? 'out'
    : phase === 'error'
      ? 'error'
      : phase === 'pushing' || phase === 'pulling'
        ? 'busy'
        : pending > 0
          ? 'pending'
          : 'ok';

  const label = session
    ? `${session.displayName}. ${
        state === 'ok'
          ? 'Everything synced'
          : state === 'pending'
            ? `${pending} changes waiting to sync`
            : state === 'busy'
              ? 'Syncing now'
              : 'Sync problem'
      }`
    : 'Not signed in';

  return (
    <button
      type="button"
      className={`account-chip account-chip-${state}`}
      aria-label={label}
      title={label}
      onClick={() => navigate('/access')}
    >
      <span className="account-chip-face" aria-hidden>
        {session ? initials(session.displayName) : '?'}
      </span>
      <span className="account-chip-dot" aria-hidden />
    </button>
  );
}
