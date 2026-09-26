// SingleTrack Events — Warehouse: the packing assistant.
//
// A Supabase Edge Function. It is the only piece of this app that runs on a
// server, and it exists for one reason: the Claude API key cannot live in a
// published web page, so something that can keep a secret has to make the
// call. This holds the key, checks that whoever is asking is a signed-in
// admin, adds the instructions, asks Claude and returns a structured answer.
// It never reads the warehouse database; the app sends everything the
// assistant needs to read, assembled on the phone from the same records the
// screens show.
//
// Deploy (see README → The packing assistant):
//   supabase functions deploy assistant
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// or paste this file into Edge Functions → New function in the dashboard.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

/** Chosen for judgement about what a remote aid station is missing. */
const MODEL = 'claude-opus-5';

/**
 * Published rates for the model above, US dollars per million tokens, used
 * only to show a rough cost on the phone. Update alongside MODEL.
 */
const RATES = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

/** What the function will read from a request body. Guards against a runaway payload. */
const MAX_BODY_BYTES = 600_000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/**
 * Who the assistant is and how it behaves. Stable across every request so
 * the prompt cache can hold it along with the catalogue.
 */
const INSTRUCTIONS = `You are the packing assistant for SingleTrack Events, a trail running event company in Victoria and New South Wales, Australia. You help the warehouse crew check aid station and event site packlists before crates leave the shed.

You know only what you are shown: the item catalogue, the destination and its races, the list being checked, the templates for that kind of destination, the food plan, earlier editions of the same station, and the notes the admin has written for you. Reason from that. Do not invent items that are not in the catalogue; if something is genuinely needed and not stocked, name it plainly with a null code so the crew can decide.

What a good check looks like:
- Missing items come first, and only the ones that matter for this station: its access (a walk-in station gets no heavy gear a quad cannot carry), its hours (lighting for anything open past dusk), its weather exposure, its runner numbers, and what the same station went out with before.
- Quantities are checked against the food plan and the runner numbers. Flag a line that looks thin or wildly over, and say what number you would use.
- Kits count for their contents. Do not suggest something a kit on the list already contains.
- A question is for something you cannot settle from the data, such as whether a station is running a second day. Keep questions few.
- The admin's notes outrank templates and history. If a note says a station never gets an item, do not suggest it.
- Keep each reason to one plain sentence in Australian English, the way an experienced crew member would say it standing at the crate. No preamble, no hedging.
- Suggest at most twelve things. Fewer, well chosen, beats a long list.
- Under notesToRemember, offer at most three short rules that would make future checks better and that the data supports, such as a pattern across earlier editions. Offer nothing if nothing stands out. Never propose a note that repeats an existing one.`;

/** The exact shape the app reads back. Mirrors CheckResult in src/assistant/protocol.ts. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'suggestions', 'notesToRemember'],
  properties: {
    summary: { type: 'string', description: 'One or two sentences on the list as a whole.' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'sku', 'name', 'qty', 'reason'],
        properties: {
          kind: { type: 'string', enum: ['missing', 'quantity', 'question'] },
          sku: {
            type: ['string', 'null'],
            description: 'The catalogue code, exactly as listed, or null when the item is not in the catalogue.',
          },
          name: { type: 'string' },
          qty: {
            type: ['number', 'null'],
            description: 'How many to add for a missing item; the required quantity to use for a quantity concern; null for a question.',
          },
          reason: { type: 'string' },
        },
      },
    },
    notesToRemember: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'scope'],
        properties: {
          text: { type: 'string' },
          scope: {
            type: 'string',
            enum: ['everywhere', 'event', 'destinationType'],
            description: 'Where the rule applies: every list, this event only, or every list for this kind of destination.',
          },
        },
      },
    },
  },
} as const;

interface CheckRequest {
  kind: 'check';
  catalogue: string;
  station: string;
  packlist: string;
  templates: string;
  foodPlan: string;
  history: string;
  notes: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

function refuse(error: string, status: number): Response {
  return json({ ok: false, error }, status);
}

/**
 * Who is calling, and are they an admin?
 *
 * The request carries the account's own token. Asking Supabase who that is,
 * and then reading their membership row under their own credentials, means
 * the same row-level security that guards the sync log guards this: a
 * volunteer's token can read a volunteer's row and nothing else.
 */
async function callerIsAdmin(request: Request): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return { ok: false, error: 'Sign in to use the assistant.', status: 401 };
  }

  const url = Deno.env.get('SUPABASE_URL');
  // The project's publishable key: injected into every function, and in any
  // case the same public value the app sends with each request.
  const key =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    request.headers.get('apikey');
  if (!url || !key) {
    return { ok: false, error: 'The function cannot see its own project settings.', status: 500 };
  }

  const supabase = createClient(url, key, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, error: 'That sign-in has expired. Sign in again and retry.', status: 401 };
  }

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('role, expires_at')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    return { ok: false, error: 'This account has no access to the warehouse.', status: 403 };
  }
  const expired = membership.expires_at && new Date(membership.expires_at) <= new Date();
  if (membership.role !== 'admin' || expired) {
    return { ok: false, error: 'Only an admin can use the packing assistant.', status: 403 };
  }
  return { ok: true };
}

function isCheck(body: unknown): body is CheckRequest {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as Record<string, unknown>;
  return (
    candidate.kind === 'check' &&
    ['catalogue', 'station', 'packlist', 'templates', 'foodPlan', 'history', 'notes'].every(
      (field) => typeof candidate[field] === 'string',
    )
  );
}

function costUsd(usage: Anthropic.Usage): number {
  const perMillion = (tokens: number, rate: number) => (tokens / 1_000_000) * rate;
  return (
    perMillion(usage.input_tokens, RATES.input) +
    perMillion(usage.output_tokens, RATES.output) +
    perMillion(usage.cache_read_input_tokens ?? 0, RATES.cacheRead) +
    perMillion(usage.cache_creation_input_tokens ?? 0, RATES.cacheWrite)
  );
}

async function check(request: CheckRequest, apiKey: string): Promise<Response> {
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8_000,
    // The instructions and the catalogue change rarely and cost the most to
    // send, so they sit first and are cached; everything about this one list
    // comes after the breakpoint.
    system: [
      { type: 'text', text: INSTRUCTIONS },
      {
        type: 'text',
        text: `The warehouse catalogue:\n${request.catalogue}`,
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          `## The destination\n${request.station}`,
          `## The list being checked\n${request.packlist}`,
          `## Templates for this kind of destination\n${request.templates}`,
          `## The food plan for this destination\n${request.foodPlan}`,
          `## History\n${request.history}`,
          `## Notes from the admin\n${request.notes}`,
          'Check this list. What is missing, what quantities look wrong, and what would you ask?',
        ].join('\n\n'),
      },
    ],
    output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
  });

  if (response.stop_reason === 'refusal') {
    return refuse('The assistant declined to answer this one. Try again, or check the list by hand.', 502);
  }
  if (response.stop_reason === 'max_tokens') {
    return refuse('The answer ran too long to finish. Try again; a shorter list helps.', 502);
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  let result: unknown = null;
  try {
    result = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : null;
  } catch {
    result = null;
  }
  if (!result) return refuse('The assistant answered in a shape the app could not read.', 502);

  return json({
    ok: true,
    model: response.model,
    result,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      costUsd: Math.round(costUsd(response.usage) * 10_000) / 10_000,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return refuse('Use POST.', 405);

  const gate = await callerIsAdmin(request);
  if (!gate.ok) return refuse(gate.error, gate.status);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return refuse(
      'The assistant has no API key yet. In Supabase, add a secret named ANTHROPIC_API_KEY under Edge Functions → Secrets.',
      503,
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse('That list is too large to check in one go.', 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse('The request was not valid JSON.', 400);
  }

  if (body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'ping') {
    return json({ ok: true, model: MODEL });
  }
  if (!isCheck(body)) return refuse('The request was missing part of the list.', 400);

  try {
    return await check(body, apiKey);
  } catch (cause) {
    if (cause instanceof Anthropic.AuthenticationError) {
      return refuse('The API key in Supabase was not accepted. Check it in the Claude Console and paste it again.', 503);
    }
    if (cause instanceof Anthropic.RateLimitError) {
      return refuse('The assistant is being asked too much at once. Wait a minute and try again.', 429);
    }
    if (cause instanceof Anthropic.APIError) {
      const message = cause.status === 400 && /credit|billing/i.test(cause.message)
        ? 'The Claude account is out of credit. Top it up in the Claude Console.'
        : `Claude returned an error (${cause.status ?? 'unknown'}): ${cause.message}`;
      return refuse(message, 502);
    }
    return refuse('Something went wrong while checking the list.', 500);
  }
});
