import { describe, expect, it } from 'vitest';
import { interpretGrid, interpretGrids, parseQty, splitInlineQty } from './importGrid';
import type { Grid } from './importGrid';

const STATIONS = ['Allview Escape', 'Grand Canyon Carpark', 'Perrys Lookdown', 'Recovery Zone'];
const CATEGORIES = ['Structure & Shelter', 'Cooking & Heating', 'Hygiene & Consumables'];

describe('parseQty', () => {
  it('reads the ways people write a count', () => {
    expect(parseQty('4')).toBe(4);
    expect(parseQty(' 4.0 ')).toBe(4);
    expect(parseQty('x4')).toBe(4);
    expect(parseQty('4 x')).toBe(4);
    expect(parseQty('2 boxes')).toBe(2);
    expect(parseQty('4 (1 spare)')).toBe(4);
    expect(parseQty('1,200')).toBe(1200);
    expect(parseQty('1.5')).toBe(1.5);
  });

  it('reads ticks as one and dashes as nothing', () => {
    expect(parseQty('✓')).toBe(1);
    expect(parseQty('x')).toBe(1);
    expect(parseQty('Y')).toBe(1);
    expect(parseQty('-')).toBe(0);
    expect(parseQty('n/a')).toBe(0);
  });

  it('knows a name from a number', () => {
    expect(parseQty('')).toBeNull();
    expect(parseQty('Trestle Tables')).toBeNull();
    expect(parseQty('Marquee 3x3 white')).toBeNull();
    expect(parseQty('Water cube 20L blue with tap')).toBeNull();
    expect(parseQty('3x3')).toBeNull();
  });
});

describe('splitInlineQty', () => {
  it('splits a count written into the name', () => {
    expect(splitInlineQty('2 x Trestle Tables')).toEqual({ name: 'Trestle Tables', qty: 2 });
    expect(splitInlineQty('Trestle Tables x2')).toEqual({ name: 'Trestle Tables', qty: 2 });
    expect(splitInlineQty('Trestle Tables (4)')).toEqual({ name: 'Trestle Tables', qty: 4 });
    expect(splitInlineQty('Trestle Tables - 4')).toEqual({ name: 'Trestle Tables', qty: 4 });
    expect(splitInlineQty('4 Trestle Tables')).toEqual({ name: 'Trestle Tables', qty: 4 });
  });

  it('leaves a name alone when the number is part of it', () => {
    expect(splitInlineQty('Marquee 3x3')).toEqual({ name: 'Marquee 3x3', qty: null });
    expect(splitInlineQty('Water cube 20L')).toEqual({ name: 'Water cube 20L', qty: null });
    expect(splitInlineQty('20L Water cube')).toEqual({ name: '20L Water cube', qty: null });
  });
});

describe('interpretGrid: matrix', () => {
  const grid: Grid = {
    name: 'Run sheet',
    rows: [
      ['Hounslow Classic 2026 — Aid Station Equipment'],
      [],
      ['Category', 'Item', 'Allview', 'GC Carpark', 'Perrys', 'Total', 'Notes'],
      ['Structure', 'Marquee 3x3', '2', '2', '2', '6', ''],
      ['', 'Marquee walls', '6', '4', '4', '14', 'check for tears'],
      ['', 'Trestle Tables', '4', '4', '', '8', ''],
      ['Cooking', '', '', '', '', '', ''],
      ['', 'Gas Bottle', '', '', '1', '1', 'hire'],
      ['', 'Kettle', '', '', '✓', '1', ''],
      ['', 'Sandbags', '-', '16', '16 (2 spare)', '32', ''],
      ['', 'TOTAL', '12', '26', '23', '61', ''],
    ],
  };

  it('finds the stations across the top and the items down the side', () => {
    const parsed = interpretGrid(grid, { placeNames: STATIONS });
    expect(parsed.layout).toBe('matrix');
    expect(parsed.places).toEqual(['Allview', 'GC Carpark', 'Perrys']);
    const perrys = parsed.lines.filter((line) => line.place === 'Perrys');
    expect(perrys.map((line) => [line.name, line.qty])).toEqual([
      ['Marquee 3x3', 2],
      ['Marquee walls', 4],
      ['Gas Bottle', 1],
      ['Kettle', 1],
      ['Sandbags', 16],
    ]);
  });

  it('ignores the total column, blank cells, dashes and the totals row', () => {
    const parsed = interpretGrid(grid);
    expect(parsed.lines.some((line) => line.place === 'Total')).toBe(false);
    expect(parsed.lines.some((line) => line.name === 'TOTAL')).toBe(false);
    expect(parsed.lines.filter((line) => line.name === 'Trestle Tables')).toHaveLength(2);
    expect(parsed.lines.filter((line) => line.name === 'Sandbags')).toHaveLength(2);
  });

  it('carries the notes column and anything written beside a number', () => {
    const parsed = interpretGrid(grid);
    const walls = parsed.lines.find((line) => line.name === 'Marquee walls' && line.place === 'Allview');
    expect(walls?.note).toBe('check for tears');
    const sandbags = parsed.lines.find((line) => line.name === 'Sandbags' && line.place === 'Perrys');
    expect(sandbags?.note).toBe('2 spare');
  });

  it('remembers the category column against each line', () => {
    const parsed = interpretGrid(grid);
    expect(parsed.lines.find((line) => line.name === 'Gas Bottle')?.section).toBe('Cooking');
    expect(parsed.lines.find((line) => line.name === 'Marquee walls')?.section).toBe('Structure');
  });

  it('treats a words-only row as a section rather than an item', () => {
    const sectioned: Grid = {
      name: 'Sheet1',
      rows: [
        ['Item', 'Aid 1', 'Aid 2'],
        ['01. Structure & Shelter', '', ''],
        ['Marquee', '1', '1'],
        ['HYGIENE', '', ''],
        ['Hand sanitiser', '2', ''],
      ],
    };
    const parsed = interpretGrid(sectioned, { categoryNames: CATEGORIES });
    expect(parsed.lines.map((line) => line.name)).toEqual(['Marquee', 'Marquee', 'Hand sanitiser']);
    expect(parsed.lines[0].section).toBe('01. Structure & Shelter');
    expect(parsed.lines[2].section).toBe('HYGIENE');
  });
});

describe('interpretGrid: sections', () => {
  it('reads one block per station, as a PDF run sheet is laid out', () => {
    const grid: Grid = {
      name: 'page 1',
      rows: [
        ['Grand Canyon Carpark'],
        ['Item', 'Qty', 'Notes'],
        ['Marquee 3x3', '2', ''],
        ['Trestle Tables', '4', ''],
        [],
        ['Perrys Lookdown'],
        ['Item', 'Qty', 'Notes'],
        ['Marquee 3x3', '2', ''],
        ['Gas Bottle', '1', 'hire'],
      ],
    };
    const parsed = interpretGrid(grid, { placeNames: STATIONS });
    expect(parsed.layout).toBe('sections');
    expect(parsed.places).toEqual(['Grand Canyon Carpark', 'Perrys Lookdown']);
    expect(parsed.lines.map((line) => [line.place, line.name, line.qty])).toEqual([
      ['Grand Canyon Carpark', 'Marquee 3x3', 2],
      ['Grand Canyon Carpark', 'Trestle Tables', 4],
      ['Perrys Lookdown', 'Marquee 3x3', 2],
      ['Perrys Lookdown', 'Gas Bottle', 1],
    ]);
    expect(parsed.lines[3].note).toBe('hire');
    expect(parsed.lastPlace).toBe('Perrys Lookdown');
  });

  it('reads a station column on a flat list', () => {
    const grid: Grid = {
      name: 'Sheet1',
      rows: [
        ['Station', 'Item', 'Qty'],
        ['Perrys', 'Gas Bottle', '1'],
        ['Perrys', 'Kettle', '1'],
        ['Allview', 'Trestle Tables', '6'],
      ],
    };
    const parsed = interpretGrid(grid);
    expect(parsed.places).toEqual(['Perrys', 'Allview']);
    expect(parsed.lines.map((line) => line.place)).toEqual(['Perrys', 'Perrys', 'Allview']);
  });

  it('carries a station across a page break', () => {
    const pages: Grid[] = [
      { name: 'page 1', rows: [['Perrys Lookdown'], ['Item', 'Qty'], ['Gas Bottle', '1']] },
      { name: 'page 2', rows: [['Item', 'Qty'], ['Kettle', '1'], ['Recovery Zone'], ['Item', 'Qty'], ['Milo', '2']] },
    ];
    const [first, second] = interpretGrids(pages, { placeNames: STATIONS });
    expect(first.lines[0].place).toBe('Perrys Lookdown');
    expect(second.lines.map((line) => [line.place, line.name])).toEqual([
      ['Perrys Lookdown', 'Kettle'],
      ['Recovery Zone', 'Milo'],
    ]);
    expect(second.places).toEqual(['Perrys Lookdown', 'Recovery Zone']);
  });
});

describe('interpretGrid: list', () => {
  it('reads a plain item and quantity list with no places', () => {
    const grid: Grid = {
      name: 'Sheet1',
      rows: [
        ['Item', 'Qty'],
        ['Marquee 3x3', '2'],
        ['Trestle Tables', '4'],
        ['Notes: pick up gas on the way', ''],
      ],
    };
    const parsed = interpretGrid(grid);
    expect(parsed.layout).toBe('list');
    expect(parsed.places).toEqual([]);
    expect(parsed.lines.map((line) => [line.name, line.qty, line.place])).toEqual([
      ['Marquee 3x3', 2, null],
      ['Trestle Tables', 4, null],
    ]);
    expect(parsed.skipped).toBe(1);
  });

  it('reads counts written into the names when there is no quantity column', () => {
    const grid: Grid = {
      name: 'Sheet1',
      rows: [['2 x Marquee 3x3'], ['Trestle Tables x 4'], ['Gas Bottle'], ['Kettle (2)']],
    };
    const parsed = interpretGrid(grid);
    expect(parsed.lines.map((line) => [line.name, line.qty])).toEqual([
      ['Marquee 3x3', 2],
      ['Trestle Tables', 4],
      ['Gas Bottle', 1],
      ['Kettle', 2],
    ]);
  });

  it('reads a headerless two-column list', () => {
    const grid: Grid = {
      name: 'Sheet1',
      rows: [['Marquee 3x3', '2'], ['Trestle Tables', '4'], ['Gas Bottle', '1']],
    };
    const parsed = interpretGrid(grid);
    expect(parsed.lines.map((line) => [line.name, line.qty])).toEqual([
      ['Marquee 3x3', 2],
      ['Trestle Tables', 4],
      ['Gas Bottle', 1],
    ]);
  });

  it('folds two mentions of the same item into two lines for the planner', () => {
    // The grid reader reports what the file says; the planner merges them.
    const grid: Grid = {
      name: 'Sheet1',
      rows: [['Item', 'Qty'], ['Gas Bottle', '1'], ['Gas Bottle', '2']],
    };
    expect(interpretGrid(grid).lines).toHaveLength(2);
  });

  it('returns empty for an empty sheet', () => {
    expect(interpretGrid({ name: 'Blank', rows: [[], ['', '']] }).layout).toBe('empty');
  });
});
