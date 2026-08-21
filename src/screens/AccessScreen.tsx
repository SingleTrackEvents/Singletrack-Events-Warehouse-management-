import { useCallback, useEffect, useState } from 'react';
import { Screen } from '../App';
import { QrCode } from '../components/QrCode';
import { ConfirmSheet, Field, Pill, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSession } from '../hooks/sessionContext';
import { SUPABASE_CONFIGURED } from '../sync';
import { clearAuthRedirect, getAuthRedirect } from '../sync/authRedirect';
import { useDestinations, useEvents } from '../hooks/useDb';
import { describeRole } from '../sync/permissions';
import { ROLE_BLURBS, ROLE_LABELS } from '../sync/types';
import type { Invite, Passkey as PasskeyType, Role, Scope } from '../sync/types';
import { formatDateTime, plural } from '../domain/format';
import { joinUrl } from '../domain/codes';
import { useLiveQuery } from 'dexie-react-hooks';

/**
 * Accounts and access.
 *
 * Two ways in, deliberately different. Core crew sign in with an email link and
 * keep that access. Volunteers scan a QR at the aid station, type their name,
 * and get exactly one packlist for one weekend — no inbox, no password, nothing
 * to remember, because race morning is the worst possible time to make someone
 * set up an account.
 */
export default function AccessScreen() {
  const { backend, session, connectDemo, connectServer, disconnect, setSession, sync, pending, phase, lastSyncAt, lastError } =
    useSession();
  const toast = useToast();
  const [signingIn, setSigningIn] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string>();

  const invites = useLiveQuery(async () => {
    if (!backend || !session || session.role !== 'admin') return [] as Invite[];
    return backend.listInvites(session);
  }, [backend, session]);

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
            The first person to sign in becomes the admin. Everyone after that needs an invite.
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
    return (
      <Screen title="Sign in" back="/more">
        <LinkFailureNotice />
        <div className="card card-pad mb-3">
          <p className="small muted">
            Connected to <span className="strong">{backend.name}</span>
            {backend.isReal ? '' : ' — a stand-in for trying the flow, not a real server.'}
          </p>
        </div>
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
            Sign in with email once. Then add a passkey and this phone will sign you in with your
            face or fingerprint from then on — no email involved.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-lg btn-block mb-4"
          onClick={() => setSigningIn(true)}
        >
          ✉️ Sign in with email
        </button>

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
            This browser does not support passkeys, so email sign-in is the only option here.
          </p>
        )}

        <p className="small muted center">
          Volunteers do not sign in — scan the QR the crew give you at your aid station.
        </p>
        <button type="button" className="btn btn-ghost btn-block mt-4" onClick={() => void disconnect()}>
          Go back to this device only
        </button>

        {signingIn ? <SignInSheet onClose={() => setSigningIn(false)} /> : null}
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
          <Pill tone={session.role === 'admin' ? 'ok' : 'info'}>{ROLE_LABELS[session.role]}</Pill>
        </div>
        <p className="tiny muted">{ROLE_BLURBS[session.role]}</p>
        <ul className="small muted mt-2" style={{ paddingLeft: '1.1em', margin: 0 }}>
          {describeRole(session.role).map((line) => (
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
                <InviteCard key={invite.id} invite={invite} />
              ))}
            </div>
          ) : (
            <div className="card card-pad center muted small">
              No invites yet. Create one per aid station and print it with the crate labels.
            </div>
          )}
        </section>
      ) : null}

      <button type="button" className="btn btn-ghost btn-block mt-4" onClick={() => setSigningOut(true)}>
        Sign out
      </button>

      {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}

      {signingOut ? (
        <ConfirmSheet
          title="Sign out?"
          body={
            pending
              ? `${plural(pending, 'change')} has not reached the server yet. Sync first or it stays on this device.`
              : 'Your data stays on this device.'
          }
          confirmLabel="Sign out"
          tone="danger"
          onCancel={() => setSigningOut(false)}
          onConfirm={() => {
            void backend.signOut().then(() => {
              setSession(null);
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
  const [sent, setSent] = useState<{ email: string; devLink?: string }>();
  const [error, setError] = useState<string>();

  const send = async () => {
    if (!backend) return;
    setError(undefined);
    try {
      const challenge = await backend.signInWithEmail(email);
      setSent({ email: challenge.email, devLink: challenge.devLink });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the link.');
    }
  };

  const complete = async (token: string) => {
    if (!backend) return;
    try {
      setSession(await backend.completeEmailSignIn(token));
      toast('Signed in');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That link did not work.');
    }
  };

  return (
    <Sheet
      title="Sign in"
      onClose={onClose}
      footer={
        sent ? undefined : (
          <>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!email.trim()} onClick={() => void send()}>
              Send link
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="stack">
          <p className="small">
            A sign-in link is on its way to <span className="strong">{sent.email}</span>. Open it on
            this phone and you are in — no password to remember.
          </p>
          {sent.devLink ? (
            <div className="card card-pad" style={{ background: 'var(--warn-bg)' }}>
              <p className="tiny strong" style={{ color: 'var(--warn)' }}>
                Demo server
              </p>
              <p className="tiny mt-2">
                There is no real inbox here, so the link is handed straight back. Tap to complete
                sign-in.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-block mt-3"
                onClick={() => void complete(sent.devLink!)}
              >
                Follow the link
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="stack">
          <LinkFailureNotice />
          <Field label="Email" hint="We send a link — there is no password to set or share.">
            {(id) => (
              <input
                id={id}
                className="input"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoFocus
                value={email}
                placeholder="jess@singletrackevents.com.au"
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
          body="That device will need an email link to sign in again."
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

/** A printable invite: QR, code and what it grants. */
function InviteCard({ invite }: { invite: Invite }) {
  const { backend, session } = useSession();
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);
  const url = joinUrl(invite.token);
  const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt) <= new Date());
  const dead = expired || Boolean(invite.revokedAt);

  return (
    <div className="card card-pad">
      <div className="row-flex" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div style={{ opacity: dead ? 0.35 : 1 }}>
          <QrCode value={url} size={104} alt={`Invite QR for ${invite.label}`} />
        </div>
        <div className="grow">
          <div className="spread">
            <span className="strong">{invite.label}</span>
            <Pill tone={dead ? 'danger' : 'ok'}>
              {invite.revokedAt ? 'Revoked' : expired ? 'Expired' : ROLE_LABELS[invite.role]}
            </Pill>
          </div>
          <p className="mono strong mt-2" style={{ fontSize: 'var(--text-lg)' }}>
            {invite.token}
          </p>
          <p className="tiny muted">
            {invite.expiresAt ? `Ends ${formatDateTime(invite.expiresAt)}` : 'No expiry'} ·{' '}
            {plural(invite.usedCount, 'person', 'people')} joined
          </p>
          {!dead ? (
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setRevoking(true)}>
              Revoke
            </button>
          ) : null}
        </div>
      </div>

      {revoking ? (
        <ConfirmSheet
          title={`Revoke ${invite.label}?`}
          body="Anyone who has already joined with it keeps working until their access expires, but nobody new can use it."
          confirmLabel="Revoke"
          tone="danger"
          onCancel={() => setRevoking(false)}
          onConfirm={() => {
            if (!backend || !session) return;
            void backend.revokeInvite(session, invite.id).then(() => {
              toast('Invite revoked');
              setRevoking(false);
            });
          }}
        />
      ) : null}
    </div>
  );
}

function InviteSheet({ onClose }: { onClose: () => void }) {
  const { backend, session } = useSession();
  const toast = useToast();
  const events = useEvents();
  const [eventId, setEventId] = useState('');
  const destinations = useDestinations(eventId || undefined);
  const [destinationId, setDestinationId] = useState('');
  const [role, setRole] = useState<Role>('volunteer');
  const [error, setError] = useState<string>();

  const create = async () => {
    if (!backend || !session) return;
    const scope: Scope = {
      eventId: eventId || null,
      // Only a volunteer gets pinned to a single aid station; a driver needs the
      // whole event to see every stop on their run.
      destinationId: role === 'volunteer' ? destinationId || null : null,
    };
    const destination = destinations?.find((entry) => entry.id === destinationId);
    const event = events?.find((entry) => entry.id === eventId);
    const label =
      role === 'volunteer' && destination
        ? destination.name
        : `${ROLE_LABELS[role]}${event ? ` — ${event.name}` : ''}`;

    try {
      await backend.createInvite(session, { role, scope, label });
      toast('Invite created');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the invite.');
    }
  };

  const needsDestination = role === 'volunteer';

  return (
    <Sheet
      title="New invite"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!eventId || (needsDestination && !destinationId)}
            onClick={() => void create()}
          >
            Create
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Access level">
          {(id) => (
            <select id={id} className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="volunteer">Volunteer — one aid station</option>
              <option value="driver">Driver — their loads for one event</option>
              <option value="crew">Crew — full operational access</option>
            </select>
          )}
        </Field>
        <p className="tiny muted">{ROLE_BLURBS[role]}</p>

        <Field label="Event">
          {(id) => (
            <select
              id={id}
              className="select"
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setDestinationId('');
              }}
            >
              <option value="">Choose an event</option>
              {(events ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        {needsDestination ? (
          <Field label="Aid station" hint="They will see this packlist and nothing else.">
            {(id) => (
              <select
                id={id}
                className="select"
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
              >
                <option value="">Choose a destination</option>
                {(destinations ?? []).map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {error ? (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
