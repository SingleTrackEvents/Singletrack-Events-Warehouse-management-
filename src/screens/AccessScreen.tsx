import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen } from '../App';
import { QrCode } from '../components/QrCode';
import { ConfirmSheet, Field, Pill, Sheet } from '../components/ui';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { useToast } from '../components/toastContext';
import { useSession } from '../hooks/sessionContext';
import { SUPABASE_CONFIGURED } from '../sync';
import { clearAuthRedirect, getAuthRedirect } from '../sync/authRedirect';
import { useDestinations, useEvents } from '../hooks/useDb';
import { describeRole } from '../sync/permissions';
import { ROLE_BLURBS, ROLE_LABELS, SyncError, defaultInviteExpiryDay, weekendSunday } from '../sync/types';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../sync/passwords';
import type { Invite, Member, Passkey as PasskeyType, Scope } from '../sync/types';
import { AccessEditor } from '../components/AccessEditor';
import { draftReady, grantOf } from '../domain/accessDraft';
import { useAccessDraft, useAutoLabel } from '../hooks/useAccessDraft';
import { formatDateTime, plural } from '../domain/format';
import { joinUrl } from '../domain/codes';
import { useLiveQuery } from 'dexie-react-hooks';

/**
 * Accounts and access.
 *
 * Two ways in, deliberately different. Core crew sign in with a password, or an
 * emailed code, and keep that access. Volunteers scan a QR at the aid station,
 * type their name, and get exactly one packlist for one weekend — no inbox, no
 * password, nothing to remember, because race morning is the worst possible
 * time to make someone set up an account.
 */
export default function AccessScreen() {
  const { backend, session, connectDemo, connectServer, disconnect, signOut, setSession, sync, pending, phase, lastSyncAt, lastError } =
    useSession();
  const toast = useToast();
  const [signingIn, setSigningIn] = useState(false);
  const [passwordSignIn, setPasswordSignIn] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string>();
  const [renaming, setRenaming] = useState(false);

  /*
   * Invites are fetched from the backend, not read from a table.
   *
   * useLiveQuery re-runs when a Dexie table it touched changes, and against the
   * real server this function touches none — it is a network call. So creating,
   * revoking or deleting an invite changed nothing the hook could observe and
   * the list sat there stale, which reads as the action having done nothing.
   * The demo backend hid it, since its invites live in a Dexie table.
   */
  const [inviteVersion, setInviteVersion] = useState(0);
  const refreshInvites = useCallback(() => setInviteVersion((current) => current + 1), []);

  const invites = useLiveQuery(async () => {
    if (!backend || !session || session.role !== 'admin') return [] as Invite[];
    return backend.listInvites(session);
  }, [backend, session, inviteVersion]);

  if (!backend) {
    return (
      <Screen title="Accounts & sync" back="/more">
        <div className="card card-pad mb-4">
          <h3>This device only</h3>
          <p className="small muted mt-2">
            Everything you enter lives on this phone. It works with no signal and costs nothing, but
            nobody else can see it — the crew swap data by exporting a file.
          </p>
        </div>

        <div className="card card-pad mb-3">
          <h3>Turn on sync</h3>
          <p className="small muted mt-2 mb-3">
            A shared database lets the warehouse, the drivers and each aid station work from the same
            live packlists, with different levels of access.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={!SUPABASE_CONFIGURED}
            onClick={() => void connectServer()}
          >
            ☁️ Connect to the SingleTrack server
          </button>
          <p className="tiny muted mt-2">
            {SUPABASE_CONFIGURED
              ? 'The first person to sign in becomes the admin. Everyone after that needs an invite.'
              : 'This build has no server set up, so nothing it does can reach the real data. Use the demo server below to try sign-in.'}
          </p>
        </div>

        <details className="card card-pad">
          <summary className="small strong">Try it without a server</summary>
          <p className="tiny muted mt-3">
            The <span className="strong">on-device demo server</span> exercises the sign-in, roles
            and invite flow without touching the real database. It stores everything on this phone,
            so it will not move data between devices.
          </p>
          <button type="button" className="btn btn-outline btn-block mt-3" onClick={connectDemo}>
            Use the demo server
          </button>
        </details>
      </Screen>
    );
  }

  if (!session) {
    /*
     * The only page a signed-out device has.
     *
     * There is no back button and, on the real server, no way out to "this
     * device only": both led to every screen in the app with nobody signed in,
     * which is the door this page exists to close. The demo keeps its exit,
     * since it is a playground and the way to leave one should be obvious.
     */
    return (
      <Screen title="Sign in">
        <LinkFailureNotice />
        <div className="card card-pad mb-3">
          <p className="small muted">
            {backend.isReal
              ? 'This phone is connected to the SingleTrack server. Sign in to see the crew’s events and packlists.'
              : `Connected to ${backend.name}, a stand-in for trying the flow rather than a real server.`}
          </p>
        </div>
        {/*
          The invite comes first. Most phones that land here signed out belong
          to a volunteer who joined in the browser and then opened the app from
          the home screen, which on an iPhone starts with nothing. Scanning the
          same card again is the whole way back in.
        */}
        <div className="card card-pad mb-4">
          <p className="small strong">Got an invite from the crew?</p>
          <p className="tiny muted mt-2">
            Scan the QR on your card or crate. No email or password needed.
          </p>
          <Link className="btn btn-primary btn-lg btn-block mt-3" to="/join?scan=1">
            📷 Scan invite QR
          </Link>
          <Link className="btn btn-ghost btn-block mt-2" to="/join">
            Type the code instead
          </Link>
        </div>

        <div className="divider" />
        <p className="small strong center mb-3">Crew with an account</p>

        {/*
          Order matters here. A passkey can only be used on a phone that has
          already had one added, so leading with it sent every first-time user
          into a failure. Email comes first until the device has been set up,
          and the wording says which is which rather than leaving people to
          guess from two buttons that look equally valid.
        */}
        <div className="card card-pad mb-3">
          <p className="small strong">First time on this phone?</p>
          <p className="tiny muted mt-2">
            {backend.signInWithPassword
              ? 'Sign in with your email and password. No password yet? Have a code emailed instead, ' +
                'then set one under Accounts & sync. Add a passkey after that and this phone will sign ' +
                'you in with your face or fingerprint from then on.'
              : 'Sign in with email once. Then add a passkey and this phone will sign you in with your ' +
                'face or fingerprint from then on, no email involved.'}
          </p>
        </div>

        {backend.signInWithPassword ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block mb-2"
              onClick={() => setPasswordSignIn(true)}
            >
              🔒 Sign in with password
            </button>
            <button
              type="button"
              className="btn btn-outline btn-block mb-4"
              onClick={() => setSigningIn(true)}
            >
              ✉️ Email me a code instead
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block mb-4"
            onClick={() => setSigningIn(true)}
          >
            ✉️ Sign in with email
          </button>
        )}

        {backend.supportsPasskeys && backend.signInWithPasskey ? (
          <>
            <div className="divider" />
            <p className="small strong center mb-2">Already added a passkey here?</p>
            <button
              type="button"
              className="btn btn-outline btn-block"
              disabled={passkeyBusy}
              onClick={() => {
                setPasskeyBusy(true);
                setPasskeyError(undefined);
                void backend
                  .signInWithPasskey!()
                  .then((next) => {
                    setSession(next);
                    toast(`Signed in as ${next.displayName}`);
                  })
                  .catch((cause: unknown) => {
                    setPasskeyError(cause instanceof Error ? cause.message : 'That did not work.');
                  })
                  .finally(() => setPasskeyBusy(false));
              }}
            >
              {passkeyBusy ? 'Waiting…' : '🔑 Use my passkey'}
            </button>
            {passkeyError ? (
              <p className="small center mt-3" style={{ color: 'var(--danger)' }}>
                {passkeyError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="tiny muted center mb-3">
            This browser does not support passkeys, so {backend.signInWithPassword ? 'password or email' : 'email'}{' '}
            sign-in is the only option here.
          </p>
        )}

        {backend.isReal ? null : (
          <button type="button" className="btn btn-ghost btn-block mt-4" onClick={() => void disconnect()}>
            Go back to this device only
          </button>
        )}

        {signingIn ? <SignInSheet onClose={() => setSigningIn(false)} /> : null}
        {passwordSignIn ? <PasswordSheet onClose={() => setPasswordSignIn(false)} /> : null}
      </Screen>
    );
  }

  return (
    <Screen title="Accounts & sync" back="/more">
      <div className="card card-pad mb-4">
        <div className="spread mb-2">
          <div className="grow">
            <h3>{session.displayName}</h3>
            <p className="small muted">{session.email ?? 'Joined by invite'}</p>
          </div>
          <Pill tone={session.role === 'admin' ? 'ok' : 'info'}>
            {ROLE_LABELS[session.role]}
            {session.access && session.role !== 'admin' ? ' · custom' : ''}
          </Pill>
        </div>
        {backend.setDisplayName ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)}>
            ✎ Change my name
          </button>
        ) : null}
        <p className="tiny muted">{ROLE_BLURBS[session.role]}</p>
        <ScopeLine scope={session.scope} />
        <ul className="small muted mt-2" style={{ paddingLeft: '1.1em', margin: 0 }}>
          {describeRole(session.role, session.scope, session.access ?? null).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {session.expiresAt ? (
          <p className="tiny muted mt-2">Access ends {formatDateTime(session.expiresAt)}.</p>
        ) : null}
      </div>

      <div className="card card-pad mb-4">
        <div className="spread mb-2">
          <span className="strong">Sync</span>
          <Pill tone={phase === 'error' ? 'danger' : pending ? 'accent' : 'ok'}>
            {phase === 'error' ? 'Problem' : pending ? `${pending} waiting` : 'Up to date'}
          </Pill>
        </div>
        <p className="tiny muted">
          {lastSyncAt ? `Last synced ${formatDateTime(lastSyncAt)}.` : 'Not synced yet.'}
          {pending ? ` ${plural(pending, 'change')} queued on this device.` : ''}
        </p>
        {lastError ? (
          <p className="tiny mt-2" style={{ color: 'var(--danger)' }}>
            {lastError}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-outline btn-block mt-3"
          disabled={phase === 'pushing' || phase === 'pulling'}
          onClick={() => void sync()}
        >
          {phase === 'pushing' || phase === 'pulling' ? 'Syncing…' : '↻ Sync now'}
        </button>
      </div>

      {backend.setPassword && !session.guest ? (
        <div className="card card-pad mb-4">
          <div className="spread mb-2">
            <span className="strong">Password</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSettingPassword(true)}
            >
              Set or change
            </button>
          </div>
          <p className="tiny muted">
            With a password this account can sign in on any device without waiting for an email,
            which is the way in when there is no inbox to check.
          </p>
        </div>
      ) : null}

      <PasskeySection />

      {session.role === 'admin' ? (
        <section className="section">
          <div className="section-head">
            <h2>Invites</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInviting(true)}>
              + New invite
            </button>
          </div>
          {invites?.length ? (
            <div className="stack">
              {invites.map((invite) => (
                <InviteCard key={invite.id} invite={invite} onChanged={refreshInvites} />
              ))}
            </div>
          ) : (
            <div className="card card-pad center muted small">
              No invites yet. Create one per aid station and print it with the crate labels.
            </div>
          )}
        </section>
      ) : null}

      {/* Bumped with the invites, since changing an invite changes its people. */}
      {session.role === 'admin' ? <PeopleSection version={inviteVersion} /> : null}

      <button type="button" className="btn btn-ghost btn-block mt-4" onClick={() => setSigningOut(true)}>
        Sign out
      </button>

      {invites?.length ? (
        <p className="tiny muted center mb-3">Swipe an invite left to delete it.</p>
      ) : null}

      {inviting ? (
        <InviteSheet onClose={() => setInviting(false)} onCreated={refreshInvites} />
      ) : null}

      {renaming ? <RenameSheet onClose={() => setRenaming(false)} /> : null}

      {settingPassword ? <SetPasswordSheet onClose={() => setSettingPassword(false)} /> : null}

      {signingOut ? (
        <ConfirmSheet
          title="Sign out?"
          body={
            pending
              ? `${plural(pending, 'change')} ${pending === 1 ? 'has' : 'have'} not reached the server yet. Sync first or ${pending === 1 ? 'it stays' : 'they stay'} on this device.`
              : 'Your data stays on this device.'
          }
          confirmLabel="Sign out"
          tone="danger"
          onCancel={() => setSigningOut(false)}
          onConfirm={() => {
            void signOut().then(() => {
              toast('Signed out');
              setSigningOut(false);
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

function SignInSheet({ onClose }: { onClose: () => void }) {
  const { backend, setSession } = useSession();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ email: string; devLink?: string; devCode?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!backend) return;
    setError(undefined);
    setBusy(true);
    try {
      const challenge = await backend.signInWithEmail(email);
      setSent({ email: challenge.email, devLink: challenge.devLink, devCode: challenge.devCode });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (run: () => Promise<import('../sync/types').Session>) => {
    setError(undefined);
    setBusy(true);
    try {
      setSession(await run());
      toast('Signed in');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Sign in"
      onClose={onClose}
      footer={
        sent ? (
          <>
            <button type="button" className="btn btn-outline" onClick={() => setSent(undefined)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={code.trim().length < 6 || busy || !backend?.verifyEmailCode}
              onClick={() => void finish(() => backend!.verifyEmailCode!(sent.email, code))}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!email.trim() || busy}
              onClick={() => void send()}
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="stack">
          <p className="small">
            Check <span className="strong">{sent.email}</span> and type the code from the message.
          </p>

          {backend?.verifyEmailCode ? (
            <Field label="Code from the email">
              {(id) => (
                <input
                  id={id}
                  className="input mono"
                  style={{ fontSize: '1.6rem', letterSpacing: '0.35em', textAlign: 'center' }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  // Supabase lets a project set 6 to 10 digits, so accept the
                  // longest rather than assuming the default.
                  maxLength={10}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
                />
              )}
            </Field>
          ) : null}

          {/*
            Typing the code beats tapping the link on a phone. A link opens
            whatever the phone treats as the default browser, and for an app
            installed to the home screen that is a separate place with its own
            storage — so the tab that opens ends up signed in while the app you
            were using does not.
          */}
          <p className="tiny muted">
            There is a link in the email too, but on a phone it opens a browser tab rather than this
            app — and only the tab ends up signed in. The code is the reliable way.
          </p>

          {sent.devCode ? (
            <div className="card card-pad" style={{ background: 'var(--warn-bg)' }}>
              <p className="tiny strong" style={{ color: 'var(--warn)' }}>
                Demo server
              </p>
              <p className="tiny mt-2">
                No real inbox here. The code is <span className="mono strong">{sent.devCode}</span>.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="small" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="stack">
          <LinkFailureNotice />
          <Field
            label="Email"
            hint="Any email you can check on this phone. We send a short numeric code: no password to set or share."
          >
            {(id) => (
              // No autoFocus on the sign-in fields: an iPhone focuses a field
              // that grabs focus on its own but often never raises the
              // keyboard, which left people with a box they could not type
              // in. Their own tap brings the keyboard up every time.
              <input
                id={id}
                className="input"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                placeholder="name@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p className="small" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Email and password, with nothing delivered.
 *
 * The invite path exists because race morning is no time to set up an account;
 * this one exists because a code in an inbox is no use to an account with no
 * inbox, or on a project whose mailer is down. Creating the account here only
 * gets as far as the account: access still comes from an invite, so a new
 * account is sent straight on to type its code.
 */
function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { backend, setSession } = useSession();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string>();
  const [needsInvite, setNeedsInvite] = useState(false);
  const [busy, setBusy] = useState(false);

  const canCreate = backend?.createAccountWithPassword !== undefined;
  const mismatch = creating && again.length > 0 && again !== password;
  const ready =
    email.trim().length > 0 &&
    password.length > 0 &&
    (!creating || (passwordProblem(password) === null && again === password));

  const submit = async () => {
    if (!backend?.signInWithPassword || !ready) return;
    setError(undefined);
    setNeedsInvite(false);
    setBusy(true);
    try {
      const next = creating
        ? await backend.createAccountWithPassword!(email, password)
        : await backend.signInWithPassword(email, password);
      setSession(next);
      toast(`Signed in as ${next.displayName}`);
      onClose();
    } catch (cause) {
      // The account exists and is on the device; what it lacks is an invite.
      if (cause instanceof SyncError && cause.kind === 'permission') setNeedsInvite(true);
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={creating ? 'Create an account' : 'Sign in'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Checking…' : creating ? 'Create account' : 'Sign in'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Email">
          {(id) => (
            <input
              id={id}
              className="input"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="username"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={creating ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
        >
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete={creating ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !creating) void submit();
              }}
            />
          )}
        </Field>
        {creating ? (
          <Field label="Password again" hint={mismatch ? 'These do not match yet.' : undefined}>
            {(id) => (
              <input
                id={id}
                className="input"
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(event) => setAgain(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
              />
            )}
          </Field>
        ) : null}

        {needsInvite ? (
          <div className="card card-pad" style={{ background: 'var(--warn-bg)' }}>
            <p className="small strong" style={{ color: 'var(--warn)' }}>
              Account ready, access not yet
            </p>
            <p className="tiny mt-2">
              Your account is on this phone. To use it you need the invite code from the crew: type
              it next and it attaches to this account.
            </p>
            <Link className="btn btn-primary btn-block mt-3" to="/join" onClick={onClose}>
              Type my invite code
            </Link>
          </div>
        ) : error ? (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}

        {canCreate ? (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              setCreating((current) => !current);
              setError(undefined);
              setNeedsInvite(false);
              setAgain('');
            }}
          >
            {creating ? 'I already have an account' : 'New here? Create an account'}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Set or change the password on the signed-in account, so a crew member who
 * only ever had a code can sign in on a phone with no inbox.
 */
function SetPasswordSheet({ onClose }: { onClose: () => void }) {
  const { backend } = useSession();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const problem = password ? passwordProblem(password) : null;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length > 0 && problem === null && again === password;

  const save = async () => {
    if (!backend?.setPassword || !ready) return;
    setError(undefined);
    setBusy(true);
    try {
      await backend.setPassword(password);
      toast('Password set');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Set a password"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="New password" hint={problem ?? `At least ${MIN_PASSWORD_LENGTH} characters.`}>
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Field label="Password again" hint={mismatch ? 'These do not match yet.' : undefined}>
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
              }}
            />
          )}
        </Field>
        {error ? (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Change the name the crew see against your work.
 *
 * The name guessed from an email is only ever a guess — "info@" and
 * "chad471@" are not names — and it is what shows on every packlist, count and
 * delivery signature, so it needs to be correctable.
 */
function RenameSheet({ onClose }: { onClose: () => void }) {
  const { backend, session, setSession } = useSession();
  const toast = useToast();
  const [name, setName] = useState(session?.displayName ?? '');
  const [error, setError] = useState<string>();

  return (
    <Sheet
      title="Change my name"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              void backend
                ?.setDisplayName?.(name)
                .then((next) => {
                  setSession(next);
                  toast('Name updated');
                  onClose();
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Could not save that.'),
                );
            }}
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Your name" hint="Shown on packlists, counts and delivery signatures.">
        {(id) => (
          <input
            id={id}
            className="input"
            autoCapitalize="words"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p className="small mt-3" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

/**
 * Passkeys for the signed-in account.
 *
 * Registering needs a live session, so the first sign-in on an account is still
 * by email — but only ever once. After a passkey is added, that device signs in
 * with a face or a fingerprint and never touches email again.
 */
function PasskeySection() {
  const { backend, session } = useSession();
  const toast = useToast();
  const [passkeys, setPasskeys] = useState<PasskeyType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<PasskeyType>();

  // Bumped to re-read the list after adding or removing one.
  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!backend?.listPasskeys) return;
    // Guarded so a slow response cannot land after the section unmounts, or
    // overwrite a newer list if the backend changed while it was in flight.
    let cancelled = false;
    void backend.listPasskeys().then((found) => {
      if (!cancelled) setPasskeys(found);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, reloads]);

  if (!backend?.supportsPasskeys || !backend.registerPasskey) return null;
  // A volunteer's access is a short-lived guest session; a passkey would outlive
  // the invite it came from, which is not what anyone means by revoking access.
  if (session?.guest) return null;

  const add = () => {
    setBusy(true);
    setError(undefined);
    const suggested = `${session?.displayName ?? 'My'} — this device`;
    void backend
      .registerPasskey!(suggested)
      .then(() => {
        toast('Passkey added — no more sign-in emails on this device');
        refresh();
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'That did not work.'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>Passkeys</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={add}>
          {busy ? 'Waiting…' : '+ Add this device'}
        </button>
      </div>

      {passkeys.length ? (
        <div className="list">
          {passkeys.map((passkey) => (
            <div key={passkey.id} className="row row-static">
              <span className="row-icon">🔑</span>
              <span className="row-body">
                <span className="row-title truncate">{passkey.name}</span>
                <span className="row-sub">
                  Added {formatDateTime(passkey.createdAt)}
                  {passkey.lastUsedAt ? ` · last used ${formatDateTime(passkey.lastUsedAt)}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${passkey.name}`}
                onClick={() => setRemoving(passkey)}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card card-pad small muted">
          Add a passkey and this phone signs in with your face, fingerprint or PIN — no email link
          to wait for, which matters when reception is poor.
        </div>
      )}

      {error ? (
        <p className="small mt-2" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {removing ? (
        <ConfirmSheet
          title={`Remove ${removing.name}?`}
          body="That device will need a password or an email code to sign in again."
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            const target = removing;
            setRemoving(undefined);
            void backend
              .deletePasskey?.(target.id)
              .then(() => {
                toast('Passkey removed');
                refresh();
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Could not remove it.'),
              );
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Explains a failed email link instead of dropping someone on the home screen
 * wondering why nothing happened.
 */
function LinkFailureNotice() {
  const [failure, setFailure] = useState(getAuthRedirect());
  if (!failure.message) return null;
  return (
    <div className="card card-pad mb-3" style={{ background: 'var(--danger-bg)' }}>
      <p className="small strong" style={{ color: 'var(--danger)' }}>
        That sign-in link did not work
      </p>
      <p className="tiny mt-2">{failure.message}</p>
      <button
        type="button"
        className="btn btn-outline btn-sm mt-3"
        onClick={() => {
          clearAuthRedirect();
          setFailure({ code: null, message: null });
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * What an account or an invite is limited to, in words.
 *
 * The event name comes from this phone's copy of the events; the one the
 * account is pinned to is always among them, since it is the one the server
 * sends.
 */
function ScopeLine({ scope }: { scope: Scope }) {
  const events = useEvents();
  const destinations = useDestinations(scope.destinationId ? scope.eventId ?? undefined : undefined);
  if (!scope.eventId) return <p className="tiny muted mt-1">Every event, and the warehouse.</p>;
  const event = events?.find((entry) => entry.id === scope.eventId);
  const destination = destinations?.find((entry) => entry.id === scope.destinationId);
  return (
    <p className="tiny muted mt-1">
      Limited to {event?.name ?? 'one event'}
      {scope.destinationId ? ` · ${destination?.name ?? 'one aid station'}` : ' only'}.
    </p>
  );
}

/** A printable invite: QR, code and what it grants. */
function InviteCard({ invite, onChanged }: { invite: Invite; onChanged: () => void }) {
  const { backend, session } = useSession();
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extending, setExtending] = useState(false);
  const [editingAccess, setEditingAccess] = useState(false);
  const url = joinUrl(invite.token);
  const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt) <= new Date());
  const dead = expired || Boolean(invite.revokedAt);

  return (
    <>
    <SwipeToDelete onDelete={() => setDeleting(true)}>
    <div className="card card-pad">
      <div className="row-flex" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div style={{ opacity: dead ? 0.35 : 1 }}>
          <QrCode value={url} size={104} alt={`Invite QR for ${invite.label}`} />
        </div>
        <div className="grow">
          <div className="spread">
            <span className="strong">{invite.label}</span>
            <Pill tone={dead ? 'danger' : invite.access ? 'accent' : 'ok'}>
              {invite.revokedAt
                ? 'Revoked'
                : expired
                  ? 'Expired'
                  : `${ROLE_LABELS[invite.role]}${invite.access ? ' · custom' : ''}`}
            </Pill>
          </div>
          <p className="mono strong mt-2" style={{ fontSize: 'var(--text-lg)' }}>
            {invite.token}
          </p>
          <p className="tiny muted">
            {invite.expiresAt ? `Ends ${formatDateTime(invite.expiresAt)}` : 'No expiry'} ·{' '}
            {plural(invite.usedCount, 'person', 'people')} joined
          </p>
          <ScopeLine scope={invite.scope} />
          <p className="tiny muted mt-1">
            {describeRole(invite.role, invite.scope, invite.access ?? null).join(' · ') ||
              'See their packlists'}
          </p>
        </div>
      </div>
      {!invite.revokedAt ? (
        <div className="row-flex mt-3" style={{ flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingAccess(true)}>
              Edit access
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExtending(true)}>
              {expired ? 'Extend' : 'Change end date'}
            </button>
            {!expired ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoking(true)}>
                Revoke
              </button>
            ) : null}
          </div>
        ) : null}
    </div>
    </SwipeToDelete>

    {/*
      Outside the swipe wrapper: it moves the card with a transform, and a
      transformed ancestor traps a fixed sheet inside the card instead of
      letting it cover the screen.
    */}
      {editingAccess ? (
        <EditInviteSheet invite={invite} onClose={() => setEditingAccess(false)} onChanged={onChanged} />
      ) : null}

      {extending ? (
        <ExpirySheet invite={invite} onClose={() => setExtending(false)} onChanged={onChanged} />
      ) : null}

      {revoking ? (
        <ConfirmSheet
          title={`Revoke ${invite.label}?`}
          body="Anyone who has already joined with it keeps working until their access expires, but nobody new can use it."
          confirmLabel="Revoke"
          tone="danger"
          onCancel={() => setRevoking(false)}
          onConfirm={() => {
            if (!backend || !session) return;
            void backend
              .revokeInvite(session, invite.id)
              .then(() => {
                toast('Invite revoked');
                onChanged();
              })
              .catch((cause: unknown) => {
                toast(cause instanceof Error ? cause.message : 'Could not revoke that invite.', 'error');
              })
              .finally(() => setRevoking(false));
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmSheet
          title={`Delete ${invite.label}?`}
          body={
            <>
              The invite goes off this list. Printed copies of its QR stop working, and{' '}
              {invite.usedCount
                ? `the ${plural(invite.usedCount, 'person', 'people')} who joined with it keep working until their access expires`
                : 'nobody has joined with it'}
              .
              {!dead ? (
                <div className="mt-2" style={{ color: 'var(--warn)' }}>
                  This one is still live. Revoke it instead if a printed copy is out at a station
                  and you want the QR to say so rather than simply stop.
                </div>
              ) : null}
            </>
          }
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            if (!backend || !session) return;
            void backend
              .deleteInvite(session, invite.id)
              .then(() => {
                toast('Invite deleted');
                onChanged();
              })
              .catch((cause: unknown) => {
                // Better a plain reason than a toast claiming success over an
                // invite that is visibly still there.
                toast(cause instanceof Error ? cause.message : 'Could not delete that invite.', 'error');
              })
              .finally(() => setDeleting(false));
          }}
        />
      ) : null}
    </>
  );
}

/** A calendar date as the date input wants it, in this phone's time zone. */
function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last minute of a picked day, so "ends Sunday" means all of Sunday. */
function endOfDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 23, 59, 0);
}

/** Today plus some days, as a date input value. */
function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

/**
 * When an invite stops: a day on the calendar, a shortcut, or no end at all.
 * Shared by the new invite sheet and "Change end date".
 */
function ExpiryField({
  day,
  noExpiry,
  today,
  onDay,
  onNoExpiry,
}: {
  day: string;
  noExpiry: boolean;
  today: string;
  onDay: (day: string) => void;
  onNoExpiry: (noExpiry: boolean) => void;
}) {
  const quick = [
    { label: new Date().getDay() === 0 ? 'Next Sunday' : 'This Sunday', day: weekendSunday(today) },
    { label: '1 week', day: daysFromNow(7) },
    { label: '1 month', day: daysFromNow(30) },
  ];
  return (
    <>
      <Field
        label="Stops working"
        hint={
          noExpiry
            ? 'Their access lasts until you revoke the invite and sign them out.'
            : 'At the end of that day. Anyone who joined loses access then too.'
        }
      >
        {(id) => (
          <>
            <input
              id={id}
              className="input"
              type="date"
              min={today}
              disabled={noExpiry}
              value={day}
              onChange={(e) => onDay(e.target.value)}
            />
            <div className="chip-row mt-2" role="group" aria-label="Quick dates">
              {quick.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="chip"
                  aria-pressed={!noExpiry && day === option.day}
                  onClick={() => {
                    onNoExpiry(false);
                    onDay(option.day);
                  }}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                aria-pressed={noExpiry}
                onClick={() => onNoExpiry(!noExpiry)}
              >
                No end date
              </button>
            </div>
          </>
        )}
      </Field>
      {!expiryOk(day, noExpiry, today) ? (
        <p className="tiny" style={{ color: 'var(--danger)' }}>
          Pick a day from today on.
        </p>
      ) : null}
    </>
  );
}

/** Date strings in this shape sort the same way the days do. */
function expiryOk(day: string, noExpiry: boolean, today: string): boolean {
  return noExpiry || (Boolean(day) && day >= today);
}

/**
 * Move an invite's end date: the weekend ran long, or a crew member is staying
 * on for the next race. Everyone who joined with it moves too, including anyone
 * whose access had already run out, so nobody has to scan a new QR.
 */
function ExpirySheet({
  invite,
  onClose,
  onChanged,
}: {
  invite: Invite;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { backend, session } = useSession();
  const toast = useToast();
  const [today] = useState(() => localDate(new Date()));
  const [day, setDay] = useState(() => {
    // Start from the current end date while it is still ahead, else a week out.
    const current = invite.expiresAt ? localDate(new Date(invite.expiresAt)) : '';
    return current && current >= today ? current : daysFromNow(7);
  });
  const [noExpiry, setNoExpiry] = useState(!invite.expiresAt);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!backend || !session) return;
    setBusy(true);
    setError(undefined);
    try {
      await backend.setInviteExpiry(session, invite.id, noExpiry ? null : endOfDay(day).toISOString());
      toast(noExpiry ? 'End date removed' : `Now ends ${formatDateTime(endOfDay(day).toISOString())}`);
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the end date.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={invite.label}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !expiryOk(day, noExpiry, today)}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          {invite.expiresAt ? `Currently ends ${formatDateTime(invite.expiresAt)}.` : 'Currently has no end date.'}{' '}
          {invite.usedCount
            ? `The ${plural(invite.usedCount, 'person', 'people')} who joined with it move to the new date too.`
            : 'Nobody has joined with it yet.'}
        </p>
        <ExpiryField day={day} noExpiry={noExpiry} today={today} onDay={setDay} onNoExpiry={setNoExpiry} />
        {error ? (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Make an invite: who it is for, what it opens, and when it stops.
 *
 * The role is a starting point. Picking one ticks the boxes that role has
 * always had, so an ordinary invite is three taps; the boxes are there for the
 * volunteer who should also see the food plan, or the crew lead who should
 * not touch transport. Until a box is touched, the ticks follow the role and
 * the event as they change.
 */
function InviteSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { backend, session } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useAccessDraft(null);
  const [today] = useState(() => localDate(new Date()));
  const events = useEvents();
  // Until a day is picked by hand, the invite lasts to the end of the chosen
  // event, and follows it if the event changes.
  const [pickedDay, setPickedDay] = useState<string>();
  const expiryDay =
    pickedDay ?? defaultInviteExpiryDay(events?.find((event) => event.id === draft.eventId), today);
  const [noExpiry, setNoExpiry] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const autoLabel = useAutoLabel(draft);

  const ready = draftReady(draft) && expiryOk(expiryDay, noExpiry, today) && !busy;

  const create = async () => {
    if (!backend || !session) return;
    setBusy(true);
    setError(undefined);
    try {
      await backend.createInvite(session, {
        ...grantOf(draft),
        label: label.trim() || autoLabel,
        expiresAt: noExpiry ? null : endOfDay(expiryDay).toISOString(),
      });
      toast('Invite created');
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the invite.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New invite"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="stack">
        <AccessEditor draft={draft} onChange={setDraft} />

        <ExpiryField
          day={expiryDay}
          noExpiry={noExpiry}
          today={today}
          onDay={setPickedDay}
          onNoExpiry={setNoExpiry}
        />

        <Field label="Name on the invite" hint="So you can tell the invites apart. Optional.">
          {(id) => (
            <input
              id={id}
              className="input"
              value={label}
              placeholder={autoLabel}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>

        <ErrorLine error={error} />
      </div>
    </Sheet>
  );
}

/**
 * Change what an existing invite gives. Everyone still following it changes
 * too, so a station captain who needs the food plan on Saturday morning gets
 * it without scanning anything new.
 */
function EditInviteSheet({
  invite,
  onClose,
  onChanged,
}: {
  invite: Invite;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { backend, session } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useAccessDraft({
    role: invite.role,
    scope: invite.scope,
    access: invite.access ?? null,
  });
  const [label, setLabel] = useState(invite.label);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const autoLabel = useAutoLabel(draft);

  const save = async () => {
    if (!backend || !session) return;
    setBusy(true);
    setError(undefined);
    try {
      await backend.updateInvite(session, invite.id, { ...grantOf(draft), label: label.trim() || autoLabel });
      toast('Invite updated');
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the invite.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Edit access"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !draftReady(draft)}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          {invite.usedCount
            ? `The ${plural(invite.usedCount, 'person', 'people')} who joined with it change too, unless you have since changed them on their own under People.`
            : 'Nobody has joined with it yet.'}
        </p>
        <AccessEditor draft={draft} onChange={setDraft} />
        <Field label="Name on the invite">
          {(id) => (
            <input
              id={id}
              className="input"
              value={label}
              placeholder={autoLabel}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <ErrorLine error={error} />
      </div>
    </Sheet>
  );
}

function ErrorLine({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="small" style={{ color: 'var(--danger)' }}>
      {error}
    </p>
  );
}

/**
 * Everyone with access, for an admin.
 *
 * The invites say what each QR gives; this says who is actually in, which is
 * the question on race weekend: who has the Aid 3 list, and can Sam see the
 * food plan yet. Tapping someone changes them on their own or takes their
 * access away.
 */
function PeopleSection({ version }: { version: number }) {
  const { backend, session } = useSession();
  const [members, setMembers] = useState<Member[]>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<Member>();
  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!backend || !session) return;
    let cancelled = false;
    backend
      .listMembers(session)
      .then((found) => {
        if (!cancelled) {
          setMembers(found);
          setError(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the people list.');
      });
    return () => {
      cancelled = true;
    };
  }, [backend, session, reloads, version]);

  return (
    <section className="section">
      <div className="section-head">
        <h2>People</h2>
        {members ? <span className="small muted">{members.length}</span> : null}
      </div>
      {error ? (
        <div className="card card-pad small" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      ) : !members ? (
        <div className="card card-pad center muted small">Loading…</div>
      ) : (
        <div className="list">
          {members.map((member) => {
            const me = member.userId === session?.userId;
            const lapsed = Boolean(member.expiresAt && new Date(member.expiresAt) <= new Date());
            return (
              <button
                key={member.userId}
                type="button"
                className="row"
                disabled={me}
                onClick={() => setEditing(member)}
              >
                <span className="row-body">
                  <span className="row-title truncate">
                    {member.displayName}
                    {me ? ' (you)' : ''}
                  </span>
                  <span className="row-sub">
                    {member.email ?? 'Joined by invite'}
                    {member.expiresAt
                      ? ` · ${lapsed ? 'ended' : 'ends'} ${formatDateTime(member.expiresAt)}`
                      : ''}
                  </span>
                  <ScopeLine scope={member.scope} />
                </span>
                <Pill tone={lapsed ? 'danger' : member.role === 'admin' ? 'ok' : member.access ? 'accent' : 'info'}>
                  {lapsed ? 'Ended' : `${ROLE_LABELS[member.role]}${member.access ? ' · custom' : ''}`}
                </Pill>
              </button>
            );
          })}
        </div>
      )}

      {editing ? (
        <MemberSheet member={editing} onClose={() => setEditing(undefined)} onChanged={refresh} />
      ) : null}
    </section>
  );
}

/** Change one person, or take their access away. */
function MemberSheet({
  member,
  onClose,
  onChanged,
}: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { backend, session } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useAccessDraft({ role: member.role, scope: member.scope, access: member.access });
  const [today] = useState(() => localDate(new Date()));
  const [expiryDay, setExpiryDay] = useState(() => {
    const current = member.expiresAt ? localDate(new Date(member.expiresAt)) : '';
    return current && current >= today ? current : daysFromNow(7);
  });
  const [noExpiry, setNoExpiry] = useState(!member.expiresAt);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const admin = draft.role === 'admin';

  const save = async () => {
    if (!backend || !session) return;
    setBusy(true);
    setError(undefined);
    try {
      await backend.updateMember(session, member.userId, {
        ...grantOf(draft),
        expiresAt: admin || noExpiry ? null : endOfDay(expiryDay).toISOString(),
      });
      toast(`${member.displayName} updated`);
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change their access.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={member.displayName}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !draftReady(draft) || (!admin && !expiryOk(expiryDay, noExpiry, today))}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          {member.email ?? 'Joined by invite'}.{' '}
          {member.inviteId
            ? 'Saving here changes just them: later changes to their invite will leave them alone.'
            : 'Their phone picks up a change the next time the app is opened with signal.'}
        </p>
        <AccessEditor
          draft={draft}
          onChange={setDraft}
          roles={['volunteer', 'driver', 'crew', 'admin']}
          roleLabel="Role"
        />
        {admin ? (
          <p className="tiny" style={{ color: 'var(--warn)' }}>
            An admin can change everything, including who else has access.
          </p>
        ) : (
          <ExpiryField
            day={expiryDay}
            noExpiry={noExpiry}
            today={today}
            onDay={setExpiryDay}
            onNoExpiry={setNoExpiry}
          />
        )}
        <ErrorLine error={error} />
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setRemoving(true)}>
          Remove their access
        </button>
      </div>

      {removing ? (
        <ConfirmSheet
          title={`Remove ${member.displayName}?`}
          body="They are signed out the next time their phone checks in, and nothing they recorded is lost. To let them back in, send them an invite."
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            if (!backend || !session) return;
            void backend
              .removeMember(session, member.userId)
              .then(() => {
                toast(`${member.displayName} removed`);
                onChanged();
                onClose();
              })
              .catch((cause: unknown) => {
                setRemoving(false);
                setError(cause instanceof Error ? cause.message : 'Could not remove them.');
              });
          }}
        />
      ) : null}
    </Sheet>
  );
}
