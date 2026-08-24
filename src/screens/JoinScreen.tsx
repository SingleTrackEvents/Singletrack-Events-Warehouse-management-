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
  const { backend, session, connectServer, setSession } = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /*
   * The code is editable, not just read from the QR.
   *
   * A scan that comes through mangled — a damaged label, a camera app that
   * rewrites the link, a code read out over the radio — otherwise leaves a
   * volunteer with no way in at all. It also means the code being sent is on
   * screen next to the one printed on the card, so a mismatch is visible
   * instead of arriving as "not recognised".
   */
  const [code, setCode] = useState(() => (token ? decodeURIComponent(token) : ''));

  const join = async () => {
    if (!backend || !code.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const joined = await backend.joinWithInvite(code.trim(), name);
      setSession(joined);
      toast(`Welcome, ${joined.displayName}`);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That invite did not work.');
      setBusy(false);
    }
  };

  /*
   * A phone with no backend at all gets the server, never the stand-in.
   *
   * That was the original bug: a scanned QR on a fresh phone connected to the
   * on-device demo, which has no invites on it, and every volunteer was told
   * their code was not recognised. But a device already on the demo is there
   * because somebody chose it — refusing to join at all made the demo useless
   * for walking the invite flow, which is the one thing it exists for. So the
   * join uses whatever is connected, and only the absence of a backend sends
   * anyone to the server.
   */
  if (!backend) {
    return (
      <Screen title="Join" back="/">
        <div className="card card-pad">
          <h3>Nearly there</h3>
          <p className="small muted mt-2 mb-3">
            This phone needs to connect to the SingleTrack server before it can use an invite.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => void connectServer()}
          >
            ☁️ Connect
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
          if (name.trim() && code.trim()) void join();
        }}
      >
        <Field label="Invite code" hint="From the QR you scanned, or read off the printed card.">
          {(id) => (
            <input
              id={id}
              className="input mono"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              placeholder="ABCD-EFGH"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          )}
        </Field>

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

        <button
          type="submit"
          className="btn btn-primary btn-lg btn-block mt-4"
          disabled={!name.trim() || !code.trim() || busy}
        >
          {busy ? 'Joining…' : "I'm in"}
        </button>
      </form>

      <p className="tiny muted center mt-4">
        {backend.isReal
          ? 'Connected to the SingleTrack server.'
          : 'On the on-device demo server — invites made on this phone only.'}
      </p>
    </Screen>
  );
}
