import { Pill } from './ui';
import { MOVE_TONE, moveLabel, moveState, movesFor } from '../domain/moves';
import type { Move } from '../domain/moves';

/**
 * The five moves across the top of an event: how many stations sit at each,
 * with the one the weekend is at lit up. Tapping a move filters to it where
 * the screen offers that.
 */
export function MoveStrip({
  counts,
  current,
  truckStage,
  selected,
  onSelect,
}: {
  counts: Record<Move, number>;
  current: Move;
  truckStage: boolean;
  /** A move the person has tapped to filter by, if any. */
  selected?: Move | null;
  onSelect?: (move: Move | null) => void;
}) {
  const moves = movesFor(truckStage);
  return (
    <div className="move-strip" role={onSelect ? 'group' : undefined} aria-label="Moves">
      {moves.map((move) => {
        const on = selected ? selected === move : move === current;
        const content = (
          <>
            <span className="move-count">{counts[move]}</span>
            <span className="move-label">{moveLabel(move, truckStage)}</span>
          </>
        );
        return onSelect ? (
          <button
            key={move}
            type="button"
            className={`move-cell${on ? ' on' : ''}`}
            aria-pressed={selected === move}
            onClick={() => onSelect(selected === move ? null : move)}
          >
            {content}
          </button>
        ) : (
          <div key={move} className={`move-cell${on ? ' on' : ''}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** Where one station's gear is, as a pill. */
export function MovePill({ move, truckStage }: { move: Move; truckStage: boolean }) {
  return <Pill tone={MOVE_TONE[move]}>{moveState(move, truckStage)}</Pill>;
}
