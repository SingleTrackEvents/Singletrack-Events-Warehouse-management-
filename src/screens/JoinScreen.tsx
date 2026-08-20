import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../App';
import { Field } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSession } from '../hooks/sessionContext';
import { ROLE_BLURBS, ROLE_LABELS } from '../sync/types';

/**
 * What a volunteer sees after scanning the invite QR taped to their crate.
 *
 * One field. No email, no password, no account to create — on race morning at
 * an aid station, anything more than typing your name is where people give up
 * and go back to the paper sheet.
 */
export default function JoinScreen() {
  const { token } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { backend, session, connectDemo, setSession } = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (!backend || !token) return;
    setBusy(true);
    setError(undefined);
    try {
      const joined = await backend.joinWithInvite(decodeURIComponent(token), name);
      setSession(joined);
      toast(`Welcome, ${joined.displayName}`);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That invite did not work.');
      setBusy(false);
    }
  };

  if (!backend) {
    return (
      <Screen title="Join" back="/">
        <div className="card card-pad">
          <h3>Sync is not switched on</h3>
          <p className="small muted mt-2 mb-3">
            This invite needs a shared database, and this device is not connected to one.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={connectDemo}>
            Connect and try again
          </button>
        </div>
      </Screen>
    );
  }

  if (session) {
    return (
      <Screen title="Join" back="/">
        <div className="card card-pad">
          <h3>Already signed in</h3>
          <p className="small muted mt-2">
            You are on this device as <span className="strong">{session.displayName}</span> (
            {ROLE_LABELS[session.role]}). Sign out from More → Accounts &amp; sync before joining with
            a different invite.
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Join the crew" back="/">
      <div className="card card-pad mb-4">
        <h3>Almost there</h3>
        <p className="small muted mt-2">
          Tell us who you are and you will get your aid station's packlist. Nothing to sign up for,
          and it keeps working once you lose reception.
        </p>
        <p className="tiny muted mt-2">{ROLE_BLURBS.volunteer}</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void join();
        }}
      >
        <Field label="Your name" hint="So the crew can see who recorded what.">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              autoCapitalize="words"
              value={name}
              placeholder="Tom Reilly"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        {error ? (
          <p className="small mt-3" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary btn-lg btn-block mt-4" disabled={!name.trim() || busy}>
          {busy ? 'Joining…' : "I'm in"}
        </button>
      </form>

      <p className="tiny muted center mt-4 mono">{token}</p>
    </Screen>
  );
}
