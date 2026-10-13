import { useEffect, useState } from 'react';
import { Sheet } from './ui';
import { useSession } from '../hooks/sessionContext';
import { hasSeenIntro, introFor, markIntroSeen } from '../domain/intro';

/**
 * The welcome tour.
 *
 * Opens by itself the first time a role is used on this phone, and again on
 * request (`openIntro`). Closing it at any point counts as seen: the tour is a
 * tap away in More or on the station screen, so it never comes back uninvited.
 */
export function IntroTour() {
  const { session, ready } = useSession();
  const { role, steps } = introFor(session);
  const [requested, setRequested] = useState(false);
  const [closed, setClosed] = useState(false);
  const [index, setIndex] = useState(0);

  // Open on the first visit for this role on this phone, or when asked.
  const open = requested || (ready && !closed && !hasSeenIntro(role));

  // Asked for from More or the station screen.
  useEffect(() => {
    const show = () => {
      setIndex(0);
      setRequested(true);
    };
    window.addEventListener('open-intro', show);
    return () => window.removeEventListener('open-intro', show);
  }, []);

  if (!open) return null;

  const close = () => {
    markIntroSeen(role);
    setRequested(false);
    setClosed(true);
    setIndex(0);
  };
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  return (
    <Sheet
      title={step.title}
      onClose={close}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => (index ? setIndex(index - 1) : close())}
          >
            {index ? 'Back' : 'Skip'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (last ? close() : setIndex(index + 1))}
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </>
      }
    >
      <div className="intro-step">
        <div className="intro-glyph" aria-hidden>
          {step.glyph}
        </div>
        {step.body.map((paragraph) => (
          <p key={paragraph} className="small mb-3">
            {paragraph}
          </p>
        ))}
        <div className="intro-dots" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((entry, at) => (
            <button
              key={entry.title}
              type="button"
              className="intro-dot"
              aria-current={at === index}
              aria-label={`Go to step ${at + 1}`}
              onClick={() => setIndex(at)}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}
