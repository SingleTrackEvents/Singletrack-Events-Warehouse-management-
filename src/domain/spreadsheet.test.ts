import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { columnIndex, decodeXml, fileKind, parseCsv, readSpreadsheet, readXlsx } from './spreadsheet';

/* A tiny zip writer, so the reader is tested against real archives. */

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function zip(files: Record<string, string>, deflate = false): ArrayBuffer {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = deflate ? 8 : 0;
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, method, true);
    view.setUint32(14, crc32(raw), true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);

    const entry = new Uint8Array(46 + nameBytes.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(16, crc32(raw), true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, raw.length, true);
    entryView.setUint16(28, nameBytes.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

/** A workbook the way Excel writes one: shared strings, numbers, a formula. */
function workbook(deflate = false): ArrayBuffer {
  return zip(
    {
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml':
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        '<sheet name="Aid Stations" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Scratch" sheetId="2" state="hidden" r:id="rId2"/>' +
        '<sheet name="Food" sheetId="3" r:id="rId3"/>' +
        '</sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships>' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/>' +
        '</Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Item</t></si><si><t>Perrys</t></si>' +
        '<si><r><t>Trestle</t></r><r><t xml:space="preserve"> Tables</t></r></si>' +
        '<si><t>Tea &amp; Coffee</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Village</t></is></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4</v></c><c r="C2"><v>6.0</v></c></row>' +
        '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="C4"><f>SUM(1,1)</f><v>2</v></c></row>' +
        '<row r="5"><c r="A5" t="str"><v>Note: total</v></c><c r="B5" t="b"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet3.xml': '<worksheet><sheetData/></worksheet>',
    },
    deflate,
  );
}

describe('readXlsx', () => {
  it('reads visible sheets in order, with shared, inline, rich and numeric cells', async () => {
    const grids = await readXlsx(workbook());
    expect(grids.map((grid) => grid.name)).toEqual(['Aid Stations', 'Food']);
    expect(grids[0].rows).toEqual([
      ['Item', 'Perrys', 'Village'],
      ['Trestle Tables', '4', '6'],
      [],
      ['Tea & Coffee', '', '2'],
      ['Note: total', 'TRUE'],
    ]);
    expect(grids[1].rows).toEqual([]);
  });

  it('inflates deflated entries', async () => {
    const grids = await readXlsx(workbook(true));
    expect(grids[0].rows[1]).toEqual(['Trestle Tables', '4', '6']);
  });

  it('refuses something that is not a workbook', async () => {
    await expect(readXlsx(zip({ 'hello.txt': 'hi' }))).rejects.toThrow(/workbook/);
    await expect(readXlsx(new TextEncoder().encode('plain text').buffer as ArrayBuffer)).rejects.toThrow(/zip/);
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded commas and Windows line endings', () => {
    const grid = parseCsv('﻿Item,Qty,Notes\r\n"Tables, trestle",4,"say ""hi"""\r\nKettle,1,\r\n');
    expect(grid.rows).toEqual([
      ['Item', 'Qty', 'Notes'],
      ['Tables, trestle', '4', 'say "hi"'],
      ['Kettle', '1', ''],
    ]);
  });

  it('works out tabs and semicolons', () => {
    expect(parseCsv('Item\tQty\nKettle\t1').rows).toEqual([['Item', 'Qty'], ['Kettle', '1']]);
    expect(parseCsv('Item;Qty\nKettle;1').rows).toEqual([['Item', 'Qty'], ['Kettle', '1']]);
  });
});

describe('helpers', () => {
  it('maps column letters and decodes entities', () => {
    expect(columnIndex('A')).toBe(0);
    expect(columnIndex('Z')).toBe(25);
    expect(columnIndex('AA')).toBe(26);
    expect(decodeXml('Tea &amp; Coffee &#8211; &#x2014; &lt;3')).toBe('Tea & Coffee – — <3');
  });

  it('tells file kinds apart by extension', () => {
    expect(fileKind('run-sheet.XLSX')).toBe('xlsx');
    expect(fileKind('list.csv')).toBe('csv');
    expect(fileKind('sheet.pdf')).toBe('pdf');
    expect(fileKind('sheet.xls')).toBe('unsupported');
  });

  it('reads a CSV file and explains an old .xls', async () => {
    const csv = { name: 'list.csv', arrayBuffer: async () => new TextEncoder().encode('Item,Qty\nKettle,1').buffer as ArrayBuffer };
    const grids = await readSpreadsheet(csv);
    expect(grids[0].name).toBe('list');
    expect(grids[0].rows[1]).toEqual(['Kettle', '1']);
    const xls = { name: 'old.xls', arrayBuffer: async () => new ArrayBuffer(0) };
    await expect(readSpreadsheet(xls)).rejects.toThrow(/xlsx/);
  });
});
