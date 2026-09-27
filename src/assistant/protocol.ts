/**
 * What travels between the app and the assistant function.
 *
 * The app assembles everything the assistant needs to read, as plain text
 * sections, and the function on the server adds the instructions, calls
 * Claude and hands back a structured answer. Keeping the assembly on the
 * device means the function never reads the database and holds nothing but
 * the API key; keeping the answer structured means the screen can offer an
 * "Add to list" button per suggestion rather than a paragraph to read.
 *
 * The function has its own copy of the result shape as a JSON schema, in
 * supabase/functions/assistant/index.ts. Change one and change the other.
 */

/** Every kind of request the function accepts. */
export type AssistantRequest = PingRequest | CheckRequest;

/** Is the function deployed, does it have a key, and which model answers. */
export interface PingRequest {
  kind: 'ping';
}

export interface PingResponse {
  ok: true;
  model: string;
}

/** Everything the assistant reads to check one packlist. */
export interface CheckRequest {
  kind: 'check';
  /**
   * The whole catalogue, one item per line. Stable between checks, so the
   * function marks it for prompt caching and later checks in the same hour
   * read it at a fraction of the price.
   */
  catalogue: string;
  /** Event, destination, access, times, the races through it and their fields. */
  station: string;
  /** The lines on the list being checked. */
  packlist: string;
  /** Templates that fit this kind of destination, with their lines. */
  templates: string;
  /** What the food plan says this station consumes. */
  foodPlan: string;
  /** The same station at earlier editions, and its siblings at this event. */
  history: string;
  /** Notes the admin has told the assistant to keep in mind here. */
  notes: string;
}

export type SuggestionKind = 'missing' | 'quantity' | 'question';

export interface Suggestion {
  kind: SuggestionKind;
  /** Catalogue code of the item, or null when it is not in the catalogue. */
  sku: string | null;
  /** The item as the crew would say it. */
  name: string;
  /**
   * For a missing item, how many to add. For a quantity concern, what the
   * required quantity should be. Null for a question.
   */
  qty: number | null;
  /** One sentence: why, in terms of this station. */
  reason: string;
}

/** Where a proposed note should apply. */
export type NoteScope = 'everywhere' | 'event' | 'destinationType';

export interface ProposedNote {
  text: string;
  scope: NoteScope;
}

export interface CheckResult {
  /** One or two sentences on the list as a whole. */
  summary: string;
  suggestions: Suggestion[];
  /** Things worth remembering for next time, offered rather than saved. */
  notesToRemember: ProposedNote[];
}

export interface CheckUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** A rough figure in US dollars, worked out from the published rates. */
  costUsd: number;
}

export interface CheckResponse {
  ok: true;
  result: CheckResult;
  usage: CheckUsage;
  model: string;
}

/** What the function sends when it cannot help. */
export interface AssistantFailure {
  ok: false;
  error: string;
}

const SUGGESTION_KINDS: SuggestionKind[] = ['missing', 'quantity', 'question'];
const NOTE_SCOPES: NoteScope[] = ['everywhere', 'event', 'destinationType'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read a result back defensively.
 *
 * The function asks for this exact shape and the model is held to a schema,
 * but the screen is going to offer buttons that write to the database off
 * the back of it, so anything malformed is dropped rather than trusted. A
 * suggestion with no name is nothing to show; a quantity that is not a
 * number is a question, not an "add 3".
 */
export function parseCheckResult(value: unknown): CheckResult {
  if (!isRecord(value)) return { summary: '', suggestions: [], notesToRemember: [] };

  const suggestions: Suggestion[] = [];
  if (Array.isArray(value.suggestions)) {
    for (const raw of value.suggestions) {
      if (!isRecord(raw)) continue;
      const name = text(raw.name);
      if (!name) continue;
      const kind = SUGGESTION_KINDS.includes(raw.kind as SuggestionKind)
        ? (raw.kind as SuggestionKind)
        : 'question';
      const qty =
        typeof raw.qty === 'number' && Number.isFinite(raw.qty) && raw.qty > 0
          ? Math.round(raw.qty * 100) / 100
          : null;
      suggestions.push({
        kind: kind !== 'question' && qty === null ? 'question' : kind,
        sku: text(raw.sku) || null,
        name,
        qty: kind === 'question' ? null : qty,
        reason: text(raw.reason),
      });
    }
  }

  const notesToRemember: ProposedNote[] = [];
  if (Array.isArray(value.notesToRemember)) {
    for (const raw of value.notesToRemember) {
      if (!isRecord(raw)) continue;
      const body = text(raw.text);
      if (!body) continue;
      notesToRemember.push({
        text: body,
        scope: NOTE_SCOPES.includes(raw.scope as NoteScope) ? (raw.scope as NoteScope) : 'everywhere',
      });
    }
  }

  return { summary: text(value.summary), suggestions, notesToRemember };
}
