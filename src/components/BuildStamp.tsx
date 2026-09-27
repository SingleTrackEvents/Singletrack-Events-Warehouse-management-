import { formatDate } from '../domain/format';
import { APP_BUILT_AT, APP_COMMIT } from '../version';

/**
 * "Build 4921bfb · 27 Sep 2026", in small faint type at the foot of a screen.
 *
 * A deploy takes a few minutes to publish and a phone a while longer to
 * notice, so the question "am I on the new version yet" comes up every time
 * something changes. This answers it without anyone having to remember a
 * version number: compare the hash with the latest commit on the deploy
 * branch and it either matches or it does not.
 */
export function BuildStamp() {
  return (
    <p className="tiny faint center mt-4">
      Build {APP_COMMIT}
      {APP_BUILT_AT ? ` · ${formatDate(APP_BUILT_AT)}` : ''}
    </p>
  );
}
