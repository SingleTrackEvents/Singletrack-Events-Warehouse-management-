import { describe, expect, it } from 'vitest';
import { cleanDisplayName, displayNameFromEmail } from './names';

describe('guessing a name from an email', () => {
  it('capitalises a bare first name', () => {
    expect(displayNameFromEmail('chad@singletrack.com.au')).toBe('Chad');
  });

  it('splits the usual work-address separators', () => {
    expect(displayNameFromEmail('jess.nolan@singletrack.com.au')).toBe('Jess Nolan');
    expect(displayNameFromEmail('dan_whitmore@example.com')).toBe('Dan Whitmore');
    expect(displayNameFromEmail('priya-shah@example.com')).toBe('Priya Shah');
  });

  it('drops trailing digits, which are never part of a name', () => {
    expect(displayNameFromEmail('chad471@gmail.com')).toBe('Chad');
    expect(displayNameFromEmail('tom.reilly99@example.com')).toBe('Tom Reilly');
  });

  it('copes with an address that is not a name at all', () => {
    expect(displayNameFromEmail('info@singletrack.com.au')).toBe('Info');
    expect(displayNameFromEmail('')).toBe('');
  });

  it('does not fall over on digits only', () => {
    expect(displayNameFromEmail('12345@example.com')).toBe('');
  });
});

describe('tidying a typed name', () => {
  it('collapses stray whitespace', () => {
    expect(cleanDisplayName('  Jess   Nolan ')).toBe('Jess Nolan');
  });

  it('caps the length so it cannot break a layout', () => {
    expect(cleanDisplayName('x'.repeat(200))).toHaveLength(120);
  });

  it('leaves a normal name alone', () => {
    expect(cleanDisplayName('Dan Whitmore')).toBe('Dan Whitmore');
  });
});
