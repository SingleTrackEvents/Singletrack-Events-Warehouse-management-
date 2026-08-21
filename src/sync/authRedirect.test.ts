import { beforeEach, describe, expect, it } from 'vitest';
import { captureAuthRedirect, clearAuthRedirect, getAuthRedirect } from './authRedirect';

/**
 * These run against a stubbed location because the failure they guard against —
 * an auth error being swallowed by the hash router — only shows up in the URL.
 */
function setUrl(hash: string) {
  const url = { pathname: '/app/', search: '', hash };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: url,
      history: {
        replaceState: (_state: unknown, _title: string, next: string) => {
          const [path, rest] = next.split('#');
          url.pathname = path;
          url.hash = rest ? `#${rest}` : '';
        },
      },
    },
  });
  return url;
}

beforeEach(() => {
  clearAuthRedirect();
});

describe('capturing an auth failure', () => {
  it('explains an expired or already-used link in plain language', () => {
    setUrl('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');

    const result = captureAuthRedirect();

    expect(result.code).toBe('otp_expired');
    expect(result.message).toMatch(/already been used, or it expired/i);
    // Worth naming, because it is the usual culprit and people never guess it.
    expect(result.message).toMatch(/preview/i);
  });

  it('strips the error from the URL so a refresh does not replay it', () => {
    const url = setUrl('#error=access_denied&error_code=otp_expired');

    captureAuthRedirect();

    expect(url.hash).toBe('');
  });

  it('keeps any real route that was alongside the error', () => {
    const url = setUrl('#error=access_denied&error_code=otp_expired&foo=bar');
    captureAuthRedirect();
    expect(url.hash).toBe('#foo=bar');
  });

  it('falls back to the provider description for codes it does not know', () => {
    setUrl('#error=weird&error_description=Something+odd+happened');
    expect(captureAuthRedirect().message).toBe('Something odd happened');
  });

  it('ignores an ordinary route', () => {
    setUrl('#/stock?filter=low');
    expect(captureAuthRedirect()).toEqual({ code: null, message: null });
  });

  it('ignores an empty hash', () => {
    setUrl('');
    expect(captureAuthRedirect()).toEqual({ code: null, message: null });
  });

  it('leaves a successful sign-in hash alone for Supabase to consume', () => {
    const url = setUrl('#access_token=abc&refresh_token=def&token_type=bearer');
    expect(captureAuthRedirect()).toEqual({ code: null, message: null });
    expect(url.hash).toBe('#access_token=abc&refresh_token=def&token_type=bearer');
  });

  it('remembers the failure for screens that render later', () => {
    setUrl('#error=access_denied&error_code=otp_expired');
    captureAuthRedirect();
    expect(getAuthRedirect().code).toBe('otp_expired');
  });

  it('forgets it once dismissed', () => {
    setUrl('#error=access_denied&error_code=otp_expired');
    captureAuthRedirect();
    clearAuthRedirect();
    expect(getAuthRedirect()).toEqual({ code: null, message: null });
  });
});
