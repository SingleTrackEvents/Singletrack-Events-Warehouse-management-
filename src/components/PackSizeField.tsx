import { Field } from './ui';
import { unitHasPackSize } from '../db/types';
import type { Unit } from '../db/types';

/**
 * Pieces per unit, asked only where the unit holds pieces.
 *
 * A box of gels contains 24; a kids tee does not contain anything. The field
 * used to be shown against every unit, and a number typed into it there
 * multiplies the whole count — 130 tees at a pack size of 130 reads as
 * "130 · 16900 ea", which is alarming and wrong.
 *
 * Where it does apply, the arithmetic is spelled out underneath as you type, so
 * a slip is visible immediately rather than on the stock list a week later.
 */
export function PackSizeField({
  unit,
  value,
  qty,
  onChange,
}: {
  unit: Unit;
  value: string;
  /** What is on hand, so the preview can show the piece count it implies. */
  qty: string;
  onChange: (next: string) => void;
}) {
  if (!unitHasPackSize(unit)) return null;

  const packSize = Math.max(1, Number(value) || 1);
  const onHand = Number(qty) || 0;
  const pieces = Math.round(onHand * packSize);

  return (
    <Field label="Pack size" hint={`Pieces in one ${unit}.`}>
      {(id) => (
        <>
          <input
            id={id}
            className="input"
            inputMode="numeric"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {packSize > 1 && onHand > 0 ? (
            <span className="tiny muted" style={{ display: 'block', marginTop: 4 }}>
              {onHand} × {packSize} = {pieces.toLocaleString()} each
            </span>
          ) : null}
        </>
      )}
    </Field>
  );
}
