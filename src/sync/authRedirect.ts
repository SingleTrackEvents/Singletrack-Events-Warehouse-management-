/**
 * Reads whatever the auth provider left in the URL after an email link.
 *
 * Two problems this solves. Supabase reports failures as hash parameters
 * (`#error=access_denied&error_code=otp_expired`), and the app uses hash
 * routing — so without capturing them first the router treats the error as a
 * bogus route, redirects to the home screen, and the person is left staring at
 * a normal app with no idea why they are not signed in.
 *
 * Must run before the router mounts.
 */

export interface AuthRedirect {
  code: string | null;
  /** Ready to show someone who is not going to read a stack trace. */
  message: string | null;
}

const EMPTY: AuthRedirect = { code: null, message: null };

let captured: AuthRedirect = EMPTY;

/** Plain-language explanations for the failures that actually happen. */
function explain(code: string | null, description: string | null): string {
  switch (code) {
    case 'otp_expired':
      return 'That sign-in link had already been used, or it expired. Links work once only — and some email apps quietly open links to preview them, which uses them up. Send a new one and open it straight away.';
    case 'access_denied':
      return 'That sign-in link was rejected. Send a new one and open it on this device.';
    case 'server_error':
      return 'The sign-in service had a problem. Try again in a moment.';
    default:
      return description || 'That sign-in link did not work. Send a new one.';
  }
}

/**
 * Pull auth parameters out of the URL and strip them, so the router never sees
 * them. Returns what was found; safe to call more than once.
 */
export function captureAuthRedirect(): AuthRedirect {
  if (typeof window === 'undefined') return EMPTY;

  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  // A successful sign-in also arrives in the hash, but Supabase consumes that
  // itself; only failures need rescuing here.
  if (!raw.includes('error')) return EMPTY;

  const params = new URLSearchParams(raw);
  const error = params.get('error');
  if (!error) return EMPTY;

  const code = params.get('error_code');
  const description = params.get('error_description');
  captured = {
    code: code ?? error,
    message: explain(code, description ? description.replace(/\+/g, ' ') : null),
  };

  // Leave the URL clean so a refresh does not resurrect the error.
  params.delete('error');
  params.delete('error_code');
  params.delete('error_description');
  const rest = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`,
  );

  return captured;
}

/** Whatever the last capture found, for screens rendered after startup. */
export function getAuthRedirect(): AuthRedirect {
  return captured;
}

export function clearAuthRedirect(): void {
  captured = EMPTY;
}
