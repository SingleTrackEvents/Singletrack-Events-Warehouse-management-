import { useCallback, useEffect, useRef, useState } from 'react';
import { Pill, Sheet } from './ui';
import { useToast } from './toastContext';
import { db } from '../db/db';
import { update } from '../db/repo';
import { useSession } from '../hooks/sessionContext';
import { addLine } from '../domain/packlists';
import { formatQty, plural } from '../domain/format';
import { buildCheckRequest } from '../assistant/context';
import { AssistantError, runCheck } from '../assistant/client';
import { formatCost } from '../assistant/cost';
import { addNote, dismissalNote, scopeFor } from '../assistant/notes';
import type { Answer, CheckResponse, ProposedNote, Suggestion } from '../assistant/protocol';
import type { Destination, Item, Packlist, PacklistLine } from '../db/types';

/**
 * The assistant's read of one list.
 *
 * Opens, gathers everything on the phone about this station, asks, and shows
 * the answer as things to act on rather than a paragraph: each missing item
 * has an "Add" button, each quantity concern a "Set to N", and anything it
 * gets wrong can be dismissed for good with one more tap. Nothing it says is
 * written to the list until somebody taps.
 *
 * Its questions can be answered in place. Answers go back with the next
 * check, so "is the station open Sunday" plus "yes, both days" becomes a
 * second day's worth of lines rather than a question left hanging, and an
 * answer can be kept as a note for the event so it is never asked again.
 */
export function AssistantCheck({
  packlist,
  destination,
  lines,
  items,
  onClose,
}: {
  packlist: Packlist;
  destination: Destination;
  lines: PacklistLine[];
  items: Map<string, Item>;
  onClose: () => void;
}) {
  const toast = useToast();
  const { backend, session } = useSession();
  const [state, setState] = useState<
    | { phase: 'running' }
    | { phase: 'failed'; message: string; setup: boolean }
    | { phase: 'done'; response: CheckResponse }
  >({ phase: 'running' });
  // Suggestions acted on or waved away, so the list shrinks as the crew works
  // through it, the same as packing mode.
  const [handled, setHandled] = useState<ReadonlySet<number>>(new Set());
  const [remembered, setRemembered] = useState<ReadonlySet<number>>(new Set());
  const [confirmDismiss, setConfirmDismiss] = useState<number>();
  // Answers to the assistant's questions, kept across rounds so it never asks
  // the same thing twice, and a copy of what it has already been sent.
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [sent, setSent] = useState<Answer[]>([]);
  // Questions whose answer has been written down as a note for the event.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const started = useRef(false);

  const bySku = new Map<string, Item>();
  for (const item of items.values()) bySku.set(item.sku, item);
  const lineFor = (item: Item) => lines.find((line) => line.itemId === item.id && !line.deletedAt);

  const run = useCallback(
    async (withAnswers: Answer[]) => {
      setState({ phase: 'running' });
      setHandled(new Set());
      setRemembered(new Set());
      setConfirmDismiss(undefined);
      try {
        if (!session) {
          throw new AssistantError('Sign in as an admin to use the assistant.', 'auth');
        }
        if (backend && !backend.isReal) {
          throw new AssistantError(
            'This phone is on the on-device demo server, which the assistant cannot use. Connect it to the SingleTrack server from More → Accounts & sync.',
            'setup',
          );
        }
        const token = (await backend?.accessToken?.()) ?? session.token;
        const request = await buildCheckRequest(packlist.id, withAnswers);
        if (!request) throw new AssistantError('This list could not be read back from the phone.', 'server');
        const response = await runCheck(request, token);
        setSent(withAnswers);
        setState({ phase: 'done', response });
      } catch (cause) {
        const failure = cause instanceof AssistantError ? cause : null;
        setState({
          phase: 'failed',
          message: failure?.message ?? 'Something went wrong while checking the list.',
          setup: failure?.kind === 'setup',
        });
      }
    },
    [backend, session, packlist.id],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run([]);
  }, [run]);

  const act = async (index: number, suggestion: Suggestion) => {
    const item = suggestion.sku ? bySku.get(suggestion.sku) : undefined;
    if (!item || suggestion.qty === null) return;
    if (suggestion.kind === 'missing') {
      await addLine(packlist.id, item.id, suggestion.qty);
      toast(`Added ${formatQty(suggestion.qty, item.unit)} ${item.name}`);
    } else if (suggestion.kind === 'quantity') {
      const line = lineFor(item);
      if (line) {
        await update(db.packlistLines, line.id, { qtyRequired: suggestion.qty });
        toast(`${item.name} now needs ${formatQty(suggestion.qty, item.unit)}`);
      } else {
        await addLine(packlist.id, item.id, suggestion.qty);
        toast(`Added ${formatQty(suggestion.qty, item.unit)} ${item.name}`);
      }
    }
    setHandled((current) => new Set(current).add(index));
  };

  const dismiss = (index: number) => {
    setHandled((current) => new Set(current).add(index));
    setConfirmDismiss(undefined);
  };

  const dismissForGood = async (index: number, suggestion: Suggestion) => {
    await addNote({
      text: dismissalNote(suggestion.name, destination.type),
      destinationType: destination.type,
      source: 'learned',
    });
    toast('Noted. It will not suggest that again for this kind of list');
    dismiss(index);
  };

  const remember = async (index: number, note: ProposedNote) => {
    await addNote({
      text: note.text,
      ...scopeFor(note.scope, { eventId: packlist.eventId, destinationType: destination.type }),
      source: 'learned',
    });
    setRemembered((current) => new Set(current).add(index));
    toast('Remembered');
  };

  /** Record or replace the answer to one question. */
  const answer = (question: string, text: string) => {
    setAnswers((current) => [
      ...current.filter((entry) => entry.question !== question),
      { question, answer: text.trim() },
    ]);
  };

  /** Keep an answer as a note for this event, so the question is settled for good. */
  const keep = async (question: string, text: string) => {
    await addNote({ text: `${question} ${text}`.trim(), eventId: packlist.eventId, source: 'learned' });
    setKept((current) => new Set(current).add(question));
    toast('Kept for this event');
  };

  const pending = answers.filter(
    (entry) => !sent.some((old) => old.question === entry.question && old.answer === entry.answer),
  );

  return (
    <Sheet title="Check this list" onClose={onClose}>
      {state.phase === 'running' ? (
        <div className="empty">
          <span className="glyph assistant-thinking" aria-hidden>
            ✨
          </span>
          <h3>{sent.length || answers.length ? 'Checking again with your answers' : 'Reading the list'}</h3>
          <p className="small">
            The catalogue, the templates for this kind of destination, the food plan and earlier
            editions of {destination.name}. Usually under a minute.
          </p>
        </div>
      ) : null}

      {state.phase === 'failed' ? (
        <div className="stack">
          <div className="card card-pad">
            <p className="strong mb-2">The assistant could not check this list</p>
            <p className="small">{state.message}</p>
            {state.setup ? (
              <p className="tiny muted mt-2">
                Setting up the assistant is covered under More → Packing assistant.
              </p>
            ) : null}
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => void run(answers)}>
              Try again
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === 'done' ? (
        <Results
          response={state.response}
          handled={handled}
          remembered={remembered}
          confirmDismiss={confirmDismiss}
          answers={answers}
          kept={kept}
          pending={pending.length}
          itemFor={(suggestion) => (suggestion.sku ? bySku.get(suggestion.sku) : undefined)}
          lineFor={lineFor}
          onAct={act}
          onDismiss={dismiss}
          onAskDismiss={setConfirmDismiss}
          onDismissForGood={dismissForGood}
          onRemember={remember}
          onAnswer={answer}
          onKeep={keep}
          onResend={() => void run(answers)}
        />
      ) : null}
    </Sheet>
  );
}

const KIND_LABELS: Record<Suggestion['kind'], string> = {
  missing: 'Missing',
  quantity: 'Quantity',
  question: 'Question',
};

const KIND_TONE: Record<Suggestion['kind'], 'warn' | 'info' | 'default'> = {
  missing: 'warn',
  quantity: 'info',
  question: 'default',
};

function Results({
  response,
  handled,
  remembered,
  confirmDismiss,
  answers,
  kept,
  pending,
  itemFor,
  lineFor,
  onAct,
  onDismiss,
  onAskDismiss,
  onDismissForGood,
  onRemember,
  onAnswer,
  onKeep,
  onResend,
}: {
  response: CheckResponse;
  handled: ReadonlySet<number>;
  remembered: ReadonlySet<number>;
  confirmDismiss: number | undefined;
  answers: Answer[];
  kept: ReadonlySet<string>;
  pending: number;
  itemFor: (suggestion: Suggestion) => Item | undefined;
  lineFor: (item: Item) => PacklistLine | undefined;
  onAct: (index: number, suggestion: Suggestion) => Promise<void>;
  onDismiss: (index: number) => void;
  onAskDismiss: (index: number | undefined) => void;
  onDismissForGood: (index: number, suggestion: Suggestion) => Promise<void>;
  onRemember: (index: number, note: ProposedNote) => Promise<void>;
  onAnswer: (question: string, text: string) => void;
  onKeep: (question: string, text: string) => Promise<void>;
  onResend: () => void;
}) {
  const { result, usage } = response;
  const open = result.suggestions.map((suggestion, index) => ({ suggestion, index })).filter(
    ({ index }) => !handled.has(index),
  );

  return (
    <div className="stack">
      {result.summary ? <p className="small">{result.summary}</p> : null}

      {!result.suggestions.length ? (
        <div className="card card-pad center muted">Nothing to add. The list reads complete.</div>
      ) : !open.length ? (
        <div className="card card-pad center muted">🎉 Every suggestion has been dealt with.</div>
      ) : (
        <div className="stack-sm">
          {open.map(({ suggestion, index }) => {
            const item = itemFor(suggestion);
            const line = item ? lineFor(item) : undefined;
            const actionable = item && suggestion.qty !== null && suggestion.kind !== 'question';
            const answered = answers.find((entry) => entry.question === suggestion.name);
            return (
              <div key={index} className="card card-pad assistant-suggestion">
                <div className="spread mb-1">
                  <span className="strong">{item?.name ?? suggestion.name}</span>
                  <Pill tone={KIND_TONE[suggestion.kind]}>{KIND_LABELS[suggestion.kind]}</Pill>
                </div>
                {suggestion.reason ? <p className="small muted">{suggestion.reason}</p> : null}
                {suggestion.kind !== 'question' && !item ? (
                  <p className="tiny muted mt-1">Not in the catalogue. Add it to Stock first if it is wanted.</p>
                ) : null}
                {suggestion.kind === 'quantity' && item && line ? (
                  <p className="tiny muted mt-1">
                    Currently {formatQty(line.qtyRequired, item.unit)} required.
                  </p>
                ) : null}

                {suggestion.kind === 'question' ? (
                  <AnswerBox
                    question={suggestion.name}
                    answered={answered?.answer}
                    kept={kept.has(suggestion.name)}
                    onAnswer={onAnswer}
                    onKeep={onKeep}
                    onDismiss={() => onDismiss(index)}
                  />
                ) : (
                  <div className="btn-row mt-2 wrap">
                    {actionable ? (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void onAct(index, suggestion)}>
                        {suggestion.kind === 'missing' || !line
                          ? `+ Add ${formatQty(suggestion.qty!, item!.unit)}`
                          : `Set to ${formatQty(suggestion.qty!, item!.unit)}`}
                      </button>
                    ) : null}
                    {confirmDismiss === index ? (
                      <>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => onDismiss(index)}>
                          Just this once
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => void onDismissForGood(index, suggestion)}
                        >
                          Never for this kind of list
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAskDismiss(index)}>
                        Dismiss
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending ? (
        <button type="button" className="btn btn-primary btn-block" onClick={onResend}>
          Send {plural(pending, 'answer')} and check again
        </button>
      ) : null}

      {result.notesToRemember.length ? (
        <section>
          <p className="small strong mb-2">Worth remembering?</p>
          <div className="stack-sm">
            {result.notesToRemember.map((note, index) => (
              <div key={index} className="card card-pad">
                <p className="small">{note.text}</p>
                <div className="btn-row mt-2">
                  {remembered.has(index) ? (
                    <Pill tone="ok">Remembered</Pill>
                  ) : (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => void onRemember(index, note)}>
                      Remember this
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="tiny muted">
        {response.model} · this check cost about {formatCost(usage.costUsd)}
        {usage.cacheReadTokens ? ' · catalogue read from cache' : ''}
      </p>
    </div>
  );
}

/**
 * One question, and the place to answer it.
 *
 * Typing is the whole interaction: an answer is kept the moment "Answer" is
 * tapped, and the "check again" button appears once anything is waiting to
 * go back. "Keep for this event" writes the answer down as a note so the
 * assistant has it next time without being told.
 */
function AnswerBox({
  question,
  answered,
  kept,
  onAnswer,
  onKeep,
  onDismiss,
}: {
  question: string;
  answered: string | undefined;
  kept: boolean;
  onAnswer: (question: string, text: string) => void;
  onKeep: (question: string, text: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState(answered ?? '');
  const [editing, setEditing] = useState(!answered);

  if (!editing && answered) {
    return (
      <div className="mt-2">
        <p className="small">
          <span className="muted">Your answer: </span>
          {answered}
        </p>
        <div className="btn-row mt-2 wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Change
          </button>
          {kept ? (
            <Pill tone="ok">Kept for this event</Pill>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void onKeep(question, answered)}>
              Keep for this event
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <textarea
        className="textarea"
        style={{ minHeight: 72 }}
        value={draft}
        placeholder="Type an answer…"
        aria-label={`Answer: ${question}`}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="btn-row mt-2 wrap">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!draft.trim()}
          onClick={() => {
            onAnswer(question, draft);
            setEditing(false);
          }}
        >
          Answer
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
