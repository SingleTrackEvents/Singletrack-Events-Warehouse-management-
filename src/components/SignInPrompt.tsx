import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../hooks/sessionContext';

/**
 * The one thing a brand new phone does not know about itself.
 *
 * The app works fully offline with no account at all, which is the right
 * default on race morning — but it means someone can spend a fortnight
 * building packlists on a phone before discovering that none of it ever left
 * that phone, and that the events their crew set up were sitting on a server
 * they never signed in to. Nothing else in the app says so: with no backend
 * connected the account chip and the sync banner both hide themselves.
 *
 * So it is said plainly, once, on the home screen — and it can be dismissed,
 * because someone genuinely running one device should not be nagged forever.
 * After that the account chip in the header is the quiet way back.
 */

const DISMISSED_KEY = 'singletrack.sync-prompt-dismissed';

function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private browsing, or storage turned off. Better to show it again than to
    // crash the home screen over a preference.
    return false;
  }
}

export function SignInPrompt() {
  const { backend, ready } = useSession();
  const [dismissed, setDismissed] = useState(alreadyDismissed);

  // Once a backend is connected the account banner takes over: it can say
  // something truthful about who you are and whether your work has synced.
  if (!ready || backend || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Nothing to do — it will simply be offered again next time.
    }
    setDismissed(true);
  };

  return (
    <section className="card card-pad mb-4 sign-in-prompt">
      <div className="spread">
        <h2 className="sign-in-prompt-title">📱 This device only</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          Not now
        </button>
      </div>
      <p className="small muted mt-2">
        Everything you add stays on this phone. Sign in and your stock, packlists and stocktakes
        sync to your other devices and to the rest of the crew — and the events they have already
        set up turn up here.
      </p>
      {/* Outline, not primary: the scan button below it is the thing people
          reach for every day, and two loud buttons stacked reads as neither. */}
      <Link className="btn btn-outline btn-block mt-3" to="/access">
        Sign in to sync
      </Link>
      <p className="tiny muted center mt-2">
        Volunteers: scan the QR code at your aid station instead. You can set this up later from
        More → Accounts &amp; sync.
      </p>
    </section>
  );
}
