import type { Grid } from './importGrid';

/**
 * Reading a workbook or a CSV into grids of cell text.
 *
 * An .xlsx file is a zip of XML documents, and the browser can already inflate
 * a zip entry (`DecompressionStream`) and the XML Excel writes is regular
 * enough to read with patterns. So the reader is written here rather than
 * pulled in as a dependency: it is a few hundred lines that never change, the
 * app stays small enough to precache for offline use, and there is nothing in
 * the supply chain to keep an eye on for a feature that runs a few times a
 * season. It reads values only — no formulas are evaluated, but the cached
 * result Excel stores beside every formula is what you would see on screen,
 * and that is what it takes.
 */

/* ------------------------------------------------------------------- zip -- */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Locate every file in the archive from its central directory. */
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits at the very end, behind an
  // optional comment of up to 64 KB.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
    if (view.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('Damaged zip archive');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, method, compressedSize, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The bytes of one entry, inflated where needed. */
async function zipRead(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== LOCAL) throw new Error('Damaged zip archive');
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Unsupported zip compression (${entry.method})`);
}

/* ------------------------------------------------------------------- xml -- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? tag.match(new RegExp(`\\b${name}='([^']*)'`));
  return match ? decodeXml(match[1]) : null;
}

/** Every `<t>` inside a run of rich text, joined — how a cell's words are stored. */
function textOf(xml: string): string {
  const parts: string[] = [];
  const pattern = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) parts.push(decodeXml(match[1] ?? ''));
  return parts.join('');
}

/** "B" → 1, "AA" → 26. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/* ------------------------------------------------------------------ xlsx -- */

/** Read every visible worksheet, in tab order. */
export async function readXlsx(buffer: ArrayBuffer): Promise<Grid[]> {
  const bytes = new Uint8Array(buffer);
  const entries = new Map(zipEntries(bytes).map((entry) => [entry.name.replace(/^\//, ''), entry]));
  const decoder = new TextDecoder();
  const text = async (name: string): Promise<string | null> => {
    const entry = entries.get(name);
    return entry ? decoder.decode(await zipRead(bytes, entry)) : null;
  };

  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel workbook');

  // Shared strings: most text in a workbook lives here, referenced by index.
  const shared: string[] = [];
  const sharedXml = await text('xl/sharedStrings.xml');
  if (sharedXml) {
    const pattern = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sharedXml))) shared.push(textOf(match[1]));
  }

  // Sheet names to their files, via the relationships part.
  const rels = new Map<string, string>();
  const relsXml = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  for (const tag of relsXml.match(/<(?:\w+:)?Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  const grids: Grid[] = [];
  for (const tag of workbook.match(/<(?:\w+:)?sheet\b[^>]*>/g) ?? []) {
    if (attr(tag, 'state') === 'hidden' || attr(tag, 'state') === 'veryHidden') continue;
    const name = attr(tag, 'name') ?? `Sheet ${grids.length + 1}`;
    const relId = attr(tag, 'r:id') ?? attr(tag, 'id');
    const path = relId ? rels.get(relId) : undefined;
    const sheetXml = path ? await text(path) : null;
    if (!sheetXml) continue;
    grids.push({ name, rows: sheetRows(sheetXml, shared) });
  }
  return grids;
}

/** The cells of one worksheet as rows of text, blanks filled in. */
function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
  const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let rowMatch: RegExpExecArray | null;
  let rowNumber = 0;
  while ((rowMatch = rowPattern.exec(xml))) {
    const declared = Number(attr(rowMatch[1], 'r'));
    rowNumber = Number.isFinite(declared) && declared > 0 ? declared : rowNumber + 1;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    let column = 0;
    while ((cellMatch = cellPattern.exec(rowMatch[2]))) {
      const ref = attr(cellMatch[1], 'r');
      const letters = ref?.match(/^([A-Z]+)/i)?.[1];
      column = letters ? columnIndex(letters) : column;
      cells[column] = cellText(cellMatch[1], cellMatch[2] ?? '', shared);
      column += 1;
    }
    for (let index = 0; index < cells.length; index += 1) cells[index] ??= '';
    rows[rowNumber - 1] = cells;
  }
  for (let index = 0; index < rows.length; index += 1) rows[index] ??= [];
  return rows;
}

function cellText(attrs: string, inner: string, shared: string[]): string {
  const type = attr(attrs, 't') ?? 'n';
  if (type === 'inlineStr') return textOf(inner).trim();
  const value = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
  if (value === undefined) return '';
  const raw = decodeXml(value).trim();
  if (type === 's') return shared[Number(raw)] ?? '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str' || type === 'e' || type === 'd') return raw;
  // Numbers: drop the trailing zeros Excel keeps, so 4.0 reads as 4.
  const number = Number(raw);
  return Number.isFinite(number) ? String(number) : raw;
}

/* ------------------------------------------------------------------- csv -- */

/** Parse delimited text, working out whether it is commas, tabs or semicolons. */
export function parseCsv(text: string, name = 'CSV'): Grid {
  const body = text.replace(/^﻿/, '');
  const sample = body.split(/\r?\n/).slice(0, 10).join('\n');
  const delimiter = [',', '\t', ';'].reduce((best, candidate) =>
    (sample.split(candidate).length > sample.split(best).length ? candidate : best),
  );

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { name, rows: rows.map((cells) => cells.map((value) => value.trim())) };
}

/* ------------------------------------------------------------------ file -- */

/** Anything with a name and bytes: a File from an input, or a test double. */
export interface NamedBlob {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ImportFileKind = 'xlsx' | 'csv' | 'pdf' | 'unsupported';

export function fileKind(name: string): ImportFileKind {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (['xlsx', 'xlsm', 'xltx'].includes(extension)) return 'xlsx';
  if (['csv', 'tsv', 'txt'].includes(extension)) return 'csv';
  if (extension === 'pdf') return 'pdf';
  return 'unsupported';
}

/** Read a workbook or CSV into grids. PDFs go through `readPdf` instead. */
export async function readSpreadsheet(file: NamedBlob): Promise<Grid[]> {
  const kind = fileKind(file.name);
  if (kind === 'xlsx') return readXlsx(await file.arrayBuffer());
  if (kind === 'csv') {
    const text = new TextDecoder().decode(await file.arrayBuffer());
    return [parseCsv(text, file.name.replace(/\.[^.]+$/, ''))];
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error('Old .xls workbooks are not supported. Save it as .xlsx and try again.');
  }
  throw new Error('Choose an Excel workbook (.xlsx), a CSV or a PDF.');
}
