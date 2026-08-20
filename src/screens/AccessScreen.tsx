import { useState } from 'react';
import { Screen } from '../App';
import { QrCode } from '../components/QrCode';
import { ConfirmSheet, Field, Pill, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { useSession } from '../hooks/sessionContext';
import { useDestinations, useEvents } from '../hooks/useDb';
import { describeRole } from '../sync/permissions';
import { ROLE_BLURBS, ROLE_LABELS } from '../sync/types';
import type { Invite, Role, Scope } from '../sync/types';
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
  const { backend, session, connectDemo, disconnect, setSession, sync, pending, phase, lastSyncAt, lastError } =
    useSession();
  const toast = useToast();
  const [signingIn, setSigningIn] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

        <div className="card card-pad">
          <h3>Turn on sync</h3>
          <p className="small muted mt-2 mb-3">
            A shared database lets the warehouse, the drivers and each aid station work from the same
            live packlists, with different levels of access.
          </p>
          <div className="card card-pad mb-3" style={{ background: 'var(--warn-bg)' }}>
            <p className="small strong" style={{ color: 'var(--warn)' }}>
              No hosted backend is connected yet.
            </p>
            <p className="tiny mt-2">
              You can switch on an <span className="strong">on-device demo server</span> to try the
              sign-in, roles and invite flow end to end. It stores data on this phone only, so it
              will not move anything between devices — that needs the real backend.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={connectDemo}>
            Try the demo server
          </button>
        </div>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen title="Sign in" back="/more">
        <div className="card card-pad mb-3">
          <p className="small muted">
            Connected to <span className="strong">{backend.name}</span>
            {backend.isReal ? '' : ' — a stand-in for trying the flow, not a real server.'}
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-block mb-3" onClick={() => setSigningIn(true)}>
          ✉️ Sign in with email
        </button>
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
