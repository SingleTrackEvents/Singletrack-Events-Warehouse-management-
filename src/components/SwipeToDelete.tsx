import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Swipe a row left to reveal a delete button.
 *
 * The swipe reveals rather than deletes: a gesture that destroys something the
 * moment your thumb leaves the glass is not what you want on a phone in a
 * moving vehicle. Tapping the revealed button then asks for confirmation.
 *
 * The button is a real button that is always in the DOM, so it is reachable by
 * keyboard and screen reader without swiping at all.
 */

/** How far the row slides to expose the button. */
const REVEAL = 96;
/** Horizontal travel before we treat the gesture as a swipe rather than a scroll. */
const ENGAGE = 12;

export function SwipeToDelete({
  children,
  onDelete,
  label = 'Delete',
}: {
  children: ReactNode;
  onDelete: () => void;
  label?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Null until the direction is known, so a vertical scroll is never hijacked.
  const horizontal = useRef<boolean | null>(null);

  const open = offset <= -REVEAL / 2;

  const onPointerDown = (event: React.PointerEvent) => {
    // Mouse drags would fight with ordinary clicking; touch and pen only.
    if (event.pointerType === 'mouse') return;
    start.current = { x: event.clientX, y: event.clientY };
    horizontal.current = null;
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;

    if (horizontal.current === null) {
      if (Math.abs(dx) < ENGAGE && Math.abs(dy) < ENGAGE) return;
      // Whichever axis moved further wins, and the decision sticks for the
      // rest of the gesture so the row cannot start sliding mid-scroll.
      horizontal.current = Math.abs(dx) > Math.abs(dy);
      if (!horizontal.current) {
        start.current = null;
        setDragging(false);
        return;
      }
    }

    const base = open ? -REVEAL : 0;
    // Rightward drag closes; leftward opens, with a hard stop past the button.
    setOffset(Math.max(-REVEAL - 16, Math.min(0, base + dx)));
  };

  const settle = () => {
    if (!start.current && horizontal.current === null) return;
    start.current = null;
    horizontal.current = null;
    setDragging(false);
    setOffset(offset < -REVEAL / 2 ? -REVEAL : 0);
  };

  return (
    <div className="swipe-row">
      <div className="swipe-row-actions" aria-hidden={!open}>
        <button
          type="button"
          className="swipe-row-delete"
          onClick={() => {
            setOffset(0);
            onDelete();
          }}
        >
          🗑 {label}
        </button>
      </div>

      <div
        className="swipe-row-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.18s ease',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
        // A tap anywhere on an open row closes it rather than following the link.
        onClickCapture={(event) => {
          if (open) {
            event.preventDefault();
            event.stopPropagation();
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
