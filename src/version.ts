/**
 * Which build of the app this is.
 *
 * Both values are baked in by vite.config.ts at build time from the git
 * checkout being built, so a deploy carries its own commit and date and
 * nobody has to bump a number by hand. Under the test runner and in a plain
 * dev server they are not defined, hence the guards.
 */
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

/** Short commit hash, or "dev" outside a real build. */
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';

/** The day the build was made, as YYYY-MM-DD, or empty outside a real build. */
export const APP_BUILT_AT: string = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : '';
