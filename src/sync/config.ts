/**
 * Backend configuration.
 *
 * The publishable key is safe in a public repository by design — it identifies
 * the project, it does not grant anything. Every permission decision is made by
 * the row-level security policies in supabase/schema.sql, which is why those
 * policies, not this file, are the thing to review carefully.
 *
 * Both values can be overridden at build time with VITE_SUPABASE_URL and
 * VITE_SUPABASE_KEY, so a second project (a staging copy, or another event
 * company running their own) needs no code change.
 */

export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://mizwsarhveepdwknupky.supabase.co';

export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_5aknaLXSWZl87yylnCytvA_N90af4Uy';

/** False when the project has been blanked out, so the UI can say so plainly. */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);
