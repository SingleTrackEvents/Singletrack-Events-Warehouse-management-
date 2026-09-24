import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Grid } from './importGrid';

/**
 * Turning a PDF page back into the table it was printed from.
 *
 * A PDF has no cells: it has pieces of text at positions on a page. A run
 * sheet exported from a spreadsheet keeps its rows level and its columns
 * lined up, though, and that is enough to recover the grid — pieces at the
 * same height are a row, and the left edges the pieces keep returning to are
 * the columns. The PDF library is loaded only when someone actually picks a
 * PDF, since it is bigger than the rest of the app put together.
 */

/** One run of text on a page: what it says and where its left edge sits. */
export interface TextPiece {
  text: string;
  /** Left edge, in PDF points. */
  x: number;
  /** Baseline height. PDF pages count upwards from the bottom. */
  y: number;
  width: number;
  height: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Lay pieces out into rows and columns.
 *
 * Words the PDF split apart are glued back together first when the gap
 * between them is no wider than a space, so "Trestle" "Tables" is one cell.
 * Column edges are then the left positions that at least two runs share; a
 * run is filed under the nearest edge at or before it.
 */
export function gridFromPieces(pieces: TextPiece[], name: string): Grid {
  const usable = pieces.filter((piece) => piece.text.trim());
  if (!usable.length) return { name, rows: [] };
  const lineHeight = median(usable.map((piece) => piece.height)) || 10;
  const rowTolerance = Math.max(2, lineHeight * 0.5);

  // Rows: top of the page first.
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextPiece[][] = [];
  for (const piece of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - piece.y) <= rowTolerance) row.push(piece);
    else rows.push([piece]);
  }

  // Runs: neighbouring pieces on a row that read as one phrase.
  const spaceWidth = lineHeight * 0.6;
  const runs: TextPiece[][] = rows.map((row) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    const merged: TextPiece[] = [];
    for (const piece of ordered) {
      const last = merged[merged.length - 1];
      if (last && piece.x - (last.x + last.width) <= spaceWidth) {
        const joiner = /\s$/.test(last.text) || /^\s/.test(piece.text) ? '' : ' ';
        last.text = `${last.text}${joiner}${piece.text}`;
        last.width = piece.x + piece.width - last.x;
      } else merged.push({ ...piece });
    }
    return merged;
  });

  // Columns: left edges that recur.
  const edgeTolerance = Math.max(4, lineHeight * 0.8);
  const starts = runs.flat().map((run) => run.x).sort((a, b) => a - b);
  const clusters: Array<{ x: number; count: number }> = [];
  for (const x of starts) {
    const cluster = clusters[clusters.length - 1];
    if (cluster && x - cluster.x <= edgeTolerance) cluster.count += 1;
    else clusters.push({ x, count: 1 });
  }
  let anchors = clusters.filter((cluster) => cluster.count >= 2).map((cluster) => cluster.x);
  if (!anchors.length) anchors = clusters.map((cluster) => cluster.x);

  const columnOf = (x: number): number => {
    let column = 0;
    for (let index = 0; index < anchors.length; index += 1) {
      if (anchors[index] <= x + edgeTolerance) column = index;
      else break;
    }
    return column;
  };

  const grid = runs.map((row) => {
    const cells: string[] = [];
    for (const run of row) {
      const column = columnOf(run.x);
      cells[column] = cells[column] ? `${cells[column]} ${run.text.trim()}` : run.text.trim();
    }
    for (let index = 0; index < cells.length; index += 1) cells[index] ??= '';
    return cells;
  });
  return { name, rows: grid };
}

/** Read every page of a PDF into a grid, one per page. */
export async function readPdf(buffer: ArrayBuffer): Promise<Grid[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const document = await task.promise;
  const grids: Grid[] = [];
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        pieces.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height || Math.abs(item.transform[3]) || 10,
        });
      }
      grids.push(gridFromPieces(pieces, document.numPages > 1 ? `page ${number}` : 'PDF'));
    }
  } finally {
    await task.destroy();
  }
  return grids;
}
