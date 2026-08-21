/**
 * Turning an email address into something worth greeting someone by.
 *
 * A best guess only — plenty of addresses are not names at all — so whatever
 * this produces is a starting point the person can overwrite.
 */

/** "jess.nolan@singletrack.com.au" → "Jess Nolan". */
export function displayNameFromEmail(email: string): string {
  const [local] = email.split('@');
  if (!local) return '';
  return (
    local
      // Separators people actually use in work addresses.
      .split(/[._+-]+/)
      .filter(Boolean)
      // Trailing digits are almost never part of a name: "chad471" → "Chad".
      .map((part) => part.replace(/\d+$/, ''))
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ')
      .trim()
  );
}

/** Tidy a name someone typed, without being precious about it. */
export function cleanDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}
