import { describe, expect, it } from 'vitest';
import { gridFromPieces } from './pdfGrid';
import type { TextPiece } from './pdfGrid';

/** A piece of text at a position, 10pt high, roughly 5pt per character wide. */
function piece(text: string, x: number, y: number): TextPiece {
  return { text, x, y, width: text.length * 5, height: 10 };
}

describe('gridFromPieces', () => {
  it('lays text out into the rows and columns it was printed in', () => {
    const grid = gridFromPieces(
      [
        piece('Item', 40, 700),
        piece('Qty', 300, 700),
        piece('Notes', 360, 700),
        piece('Marquee 3x3', 40, 680),
        piece('2', 300, 680),
        piece('Trestle Tables', 40, 660),
        piece('4', 300, 660),
        piece('check legs', 360, 660),
      ],
      'page 1',
    );
    expect(grid.rows).toEqual([
      ['Item', 'Qty', 'Notes'],
      ['Marquee 3x3', '2'],
      ['Trestle Tables', '4', 'check legs'],
    ]);
  });

  it('glues words the PDF split apart back into one cell', () => {
    const grid = gridFromPieces(
      [
        piece('Trestle', 40, 660),
        piece('Tables', 40 + 7 * 5 + 3, 660),
        piece('4', 300, 660),
        piece('Gas', 40, 640),
        piece('Bottle', 40 + 3 * 5 + 3, 640),
        piece('1', 300, 640),
      ],
      'page 1',
    );
    expect(grid.rows).toEqual([
      ['Trestle Tables', '4'],
      ['Gas Bottle', '1'],
    ]);
  });

  it('keeps a slightly uneven baseline on one row', () => {
    const grid = gridFromPieces([piece('Kettle', 40, 600), piece('1', 300, 602)], 'page 1');
    expect(grid.rows).toEqual([['Kettle', '1']]);
  });

  it('files a one-off heading under the column it starts nearest', () => {
    const grid = gridFromPieces(
      [
        piece('Perrys Lookdown', 40, 720),
        piece('Item', 40, 700),
        piece('Qty', 300, 700),
        piece('Kettle', 40, 680),
        piece('1', 300, 680),
      ],
      'page 1',
    );
    expect(grid.rows[0]).toEqual(['Perrys Lookdown']);
    expect(grid.rows[2]).toEqual(['Kettle', '1']);
  });

  it('returns nothing for a blank page', () => {
    expect(gridFromPieces([piece('  ', 0, 0)], 'page 1').rows).toEqual([]);
  });
});
