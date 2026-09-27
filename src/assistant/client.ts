import { SUPABASE_KEY, SUPABASE_URL } from '../sync/config';
import type { AssistantFailure, AssistantRequest, CheckRequest, CheckResponse, PingResponse } from './protocol';
import { parseCheckResult } from './protocol';

/**
 * Talking to the assistant function.
 *
 * The function lives in the same Supabase project as the sync log and is
 * called with the signed-in account's token, so it can check for itself that
 * the caller is an admin before it spends any money. The app never holds the
 * Claude key: a published site can keep no secrets, and a key in the bundle
 * would be everyone's key.
 */

/** Where the function is served. Overridable for a second project or local testing. */
export function assistantUrl(): string {
  const override = import.meta.env.VITE_ASSISTANT_URL as string | undefined;
  return override || `${SUPABASE_URL}/functions/v1/assistant`;
}

export type AssistantErrorKind = 'offline' | 'auth' | 'setup' | 'server';

/** Why a check did not happen, worded for the person holding the phone. */
export class AssistantError extends Error {
  kind: AssistantErrorKind;

  constructor(message: string, kind: AssistantErrorKind) {
    super(message);
    this.name = 'AssistantError';
    this.kind = kind;
  }
}

/** How long to wait before giving up on an answer. A thorough check can take a minute. */
const TIMEOUT_MS = 180_000;

async function call<T>(request: AssistantRequest, token: string): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AssistantError('The assistant needs a connection. Everything else keeps working offline.', 'offline');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(assistantUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new AssistantError(
      aborted
        ? 'The assistant took too long to answer. Try again in a moment.'
        : 'Could not reach the assistant. Check the connection, or that the function has been deployed.',
      aborted ? 'server' : 'offline',
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as T | AssistantFailure | null;
  if (!response.ok || !body || (body as AssistantFailure).ok === false) {
    const message = (body as AssistantFailure | null)?.error || `The assistant answered with an error (${response.status}).`;
    throw new AssistantError(message, kindFor(response.status));
  }
  return body as T;
}

function kindFor(status: number): AssistantErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 || status === 503) return 'setup';
  return 'server';
}

/** Is the function there, and does it have a key? */
export async function pingAssistant(token: string): Promise<PingResponse> {
  return call<PingResponse>({ kind: 'ping' }, token);
}

/** Run a check. The result is re-read defensively before the screen trusts it. */
export async function runCheck(request: CheckRequest, token: string): Promise<CheckResponse> {
  const response = await call<CheckResponse>(request, token);
  return { ...response, result: parseCheckResult(response.result) };
}
