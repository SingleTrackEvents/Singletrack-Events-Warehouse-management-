import { describe, expect, it } from 'vitest';
import { parseCheckResult } from './protocol';
import { formatCost } from './cost';

describe('reading a check result back', () => {
  it('keeps a well-formed answer as it is', () => {
    const result = parseCheckResult({
      summary: 'Looks close.',
      suggestions: [
        { kind: 'missing', sku: 'PWR-GEN', name: 'Generator', qty: 1, reason: 'No power at the carpark.' },
        { kind: 'quantity', sku: 'FD-COKE', name: 'Coke', qty: 12, reason: 'Plan calls for 12.' },
        { kind: 'question', sku: null, name: 'Second day?', qty: null, reason: 'Is the station open Sunday?' },
      ],
      notesToRemember: [{ text: 'GC Carpark has no power.', scope: 'destinationType' }],
    });
    expect(result.summary).toBe('Looks close.');
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toMatchObject({ kind: 'missing', sku: 'PWR-GEN', qty: 1 });
    expect(result.notesToRemember[0].scope).toBe('destinationType');
  });

  it('drops anything the screen could not act on safely', () => {
    // A button writes to the list off the back of these, so a suggestion
    // without a name, or a quantity that is not a number, cannot be trusted.
    const result = parseCheckResult({
      suggestions: [
        { kind: 'missing', name: '', qty: 3 },
        { kind: 'missing', name: 'Tables', qty: 'three', sku: 'TBL' },
        { kind: 'nonsense', name: 'Chairs', qty: -2 },
        'not even an object',
      ],
      notesToRemember: [{ text: '   ' }, { text: 'Keep this', scope: 'made-up' }],
    });
    expect(result.suggestions.map((s) => s.name)).toEqual(['Tables', 'Chairs']);
    // No usable quantity turns an "add" into a question rather than an add of nothing.
    expect(result.suggestions.every((s) => s.kind === 'question' && s.qty === null)).toBe(true);
    expect(result.notesToRemember).toEqual([{ text: 'Keep this', scope: 'everywhere' }]);
  });

  it('survives an answer that is not an object at all', () => {
    expect(parseCheckResult(null)).toEqual({ summary: '', suggestions: [], notesToRemember: [] });
    expect(parseCheckResult('yes')).toEqual({ summary: '', suggestions: [], notesToRemember: [] });
  });
});

describe('showing what a check cost', () => {
  it('rounds to what a person would say', () => {
    expect(formatCost(0.0012)).toBe('under 1¢');
    expect(formatCost(0.094)).toBe('9¢');
    expect(formatCost(1.2)).toBe('$1.20');
  });
});
