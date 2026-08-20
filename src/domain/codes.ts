/**
 * Short human codes for packlists and crates.
 *
 * These are what gets printed on a crate label under the QR code. A code has to
 * survive being read out over a radio in the wind, so the alphabet leaves out
 * characters that get confused when handwritten or spoken: I/1, O/0, S/5, Z/2.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789';

/** Random unambiguous suffix, e.g. "7K2M". */
export function randomSuffix(length = 4): string {
  let out = '';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Build a prefix from a destination name: initials of the words leading up to
 * the first number, then the number itself. "Aid Station 3 — Keppel Hut" becomes
 * "AS3", which is what the crew already writes on the crate in marker pen.
 */
export function prefixFor(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim();
  if (!cleaned) return 'PL';
  const words = cleaned.split(/\s+/);
  const numberAt = words.findIndex((word) => /^\d+$/.test(word));
  const number = numberAt >= 0 ? words[numberAt] : '';
  // Words after the number are descriptive ("Keppel Hut") and only make the
  // code longer, so they are dropped once a number has been found.
  const source = numberAt >= 0 ? words.slice(0, numberAt) : words;
  const letters = source
    .filter((word) => /[A-Za-z]/.test(word))
    .slice(0, 3)
    .map((word) => word[0].toUpperCase())
    .join('');
  const prefix = `${letters}${number}`.slice(0, 5);
  return prefix || 'PL';
}

/** A full packlist code, e.g. "AS3-7K2M". */
export function makeCode(name: string): string {
  return `${prefixFor(name)}-${randomSuffix()}`;
}

/** A crate code within a packlist, e.g. "AS3-7K2M/02". */
export function makeContainerCode(packlistCode: string, index: number): string {
  return `${packlistCode}/${String(index).padStart(2, '0')}`;
}

/** Normalise anything typed or scanned into the canonical uppercase form. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Pull a code out of a scanned value. Accepts a bare code ("AS3-7K2M"), a deep
 * link ("https://.../#/scan/AS3-7K2M") or a crate code with a suffix.
 */
export function parseScan(raw: string): { code: string; container: string | null } | null {
  const value = raw.trim();
  if (!value) return null;
  const afterHash = value.includes('/scan/') ? value.split('/scan/').pop()! : value;
  const cleaned = normaliseCode(decodeURIComponent(afterHash.split('?')[0]));
  const match = cleaned.match(/^([A-Z0-9]{1,6}-[A-Z0-9]{3,6})(?:\/(\d{1,3}))?$/);
  if (!match) return null;
  return { code: match[1], container: match[2] ?? null };
}

/** Human-readable context carried alongside a code so a label describes itself. */
export interface ScanLabel {
  /** Packlist name, e.g. "Aid 3 — Buffalo Plateau". */
  name?: string;
  /** Event name, e.g. "Buffalo Stampede". */
  event?: string;
}

/**
 * The URL encoded into a QR label.
 *
 * The code alone is only a pointer into whichever device's database created it,
 * so a label scanned on any other phone used to be a dead end. The name and
 * event ride along in the query string, which means a crate can always tell you
 * what it is even where the packlist itself is not stored. `parseScan` drops the
 * query before matching, so labels printed before this change still resolve.
 */
export function scanUrl(code: string, label: ScanLabel = {}, origin?: string): string {
  const base =
    origin ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '');
  const params = new URLSearchParams();
  if (label.name) params.set('n', label.name);
  if (label.event) params.set('e', label.event);
  const query = params.toString();
  return `${base}#/scan/${encodeURIComponent(code)}${query ? `?${query}` : ''}`;
}

/** The URL behind a volunteer invite QR. */
export function joinUrl(token: string, origin?: string): string {
  const base =
    origin ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '');
  return `${base}#/join/${encodeURIComponent(token)}`;
}
