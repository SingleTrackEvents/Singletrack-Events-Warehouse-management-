/**
 * Password rules, shared by every backend and the sign-in screens.
 *
 * Deliberately short. The password is the second factor behind an invite, not
 * the only gate: an account with no membership can read nothing, so the rule
 * only needs to stop the obviously guessable, not stand in for a policy.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** Why a password will be refused, or null when it is fine to use. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.trim() !== password) {
    return 'A password cannot start or end with a space.';
  }
  return null;
}
