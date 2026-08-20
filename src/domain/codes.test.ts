import { describe, expect, it } from 'vitest';
import {
  makeCode,
  makeContainerCode,
  normaliseCode,
  parseScan,
  prefixFor,
  randomSuffix,
  scanUrl,
} from './codes';

describe('short codes', () => {
  it('builds a prefix from initials and any number in the name', () => {
    expect(prefixFor('Aid Station 3 - Keppel Hut')).toBe('AS3');
    expect(prefixFor('Event Village — Bright')).toBe('EVB');
    expect(prefixFor('Aid 1')).toBe('A1');
    expect(prefixFor('Aid 1 — Mystic Hill')).toBe('A1');
  });

  it('falls back to a usable prefix for nameless input', () => {
    expect(prefixFor('')).toBe('PL');
    expect(prefixFor('###')).toBe('PL');
  });

  it('leaves out characters that get confused when read aloud', () => {
    const sample = Array.from({ length: 200 }, () => randomSuffix(6)).join('');
    expect(sample).not.toMatch(/[IOSZ0125]/);
  });

  it('produces codes in the printed label format', () => {
    expect(makeCode('Aid 2 — Eurobin Creek')).toMatch(/^[A-Z0-9]{2,5}-[A-Z0-9]{4}$/);
  });

  it('numbers crate codes off the packlist code', () => {
    expect(makeContainerCode('AS3-7K2M', 2)).toBe('AS3-7K2M/02');
    expect(makeContainerCode('AS3-7K2M', 11)).toBe('AS3-7K2M/11');
  });
});

describe('parsing a scan', () => {
  it('accepts a bare code in any case or spacing', () => {
    expect(parseScan('as3-7k2m')).toEqual({ code: 'AS3-7K2M', container: null });
    expect(parseScan('  AS3-7K2M \n')).toEqual({ code: 'AS3-7K2M', container: null });
  });

  it('pulls the code out of a deep link', () => {
    expect(parseScan('https://warehouse.example/app/#/scan/AS3-7K2M')).toEqual({
      code: 'AS3-7K2M',
      container: null,
    });
  });

  it('keeps the crate number from a container label', () => {
    expect(parseScan('EVB-Q4TU/03')).toEqual({ code: 'EVB-Q4TU', container: '03' });
  });

  it('rejects anything that is not a warehouse code', () => {
    expect(parseScan('9310072010419')).toBeNull();
    expect(parseScan('')).toBeNull();
    expect(parseScan('just some text')).toBeNull();
  });

  it('normalises typed input for comparison', () => {
    expect(normaliseCode(' as3 - 7k2m ')).toBe('AS3-7K2M');
  });
});

describe('scan URLs', () => {
  it('carries the packlist and event name so a label describes itself', () => {
    const url = scanUrl('A3-RF33', { name: 'Aid 3 — Buffalo Plateau', event: 'Buffalo Stampede' }, 'https://example.test/app/');
    expect(url).toContain('#/scan/A3-RF33?');
    const query = new URLSearchParams(url.split('?')[1]);
    expect(query.get('n')).toBe('Aid 3 — Buffalo Plateau');
    expect(query.get('e')).toBe('Buffalo Stampede');
  });

  it('omits the query when there is nothing to say', () => {
    expect(scanUrl('A3-RF33', {}, 'https://example.test/app/')).toBe(
      'https://example.test/app/#/scan/A3-RF33',
    );
  });

  it('still parses back to the bare code, so labels stay scannable', () => {
    const url = scanUrl('A3-RF33', { name: 'Aid 3 — Buffalo Plateau', event: 'Buffalo Stampede' }, 'https://example.test/app/');
    expect(parseScan(url)).toEqual({ code: 'A3-RF33', container: null });
  });

  it('parses a crate label that carries context too', () => {
    const url = scanUrl('A3-RF33/02', { name: 'Aid 3' }, 'https://example.test/app/');
    expect(parseScan(url)).toEqual({ code: 'A3-RF33', container: '02' });
  });

  it('still accepts labels printed before context was added', () => {
    expect(parseScan('https://example.test/app/#/scan/A3-RF33')).toEqual({
      code: 'A3-RF33',
      container: null,
    });
  });
});
