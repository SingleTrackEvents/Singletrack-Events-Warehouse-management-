import { createContext, useContext } from 'react';

/**
 * Toast plumbing, kept apart from the components that use it so both modules
 * stay fast-refresh friendly.
 */

export type ToastTone = 'ok' | 'error' | 'warn';

export interface ToastOptions {
  /**
   * Puts an Undo button on the toast and keeps it up long enough to reach.
   * For removals a gloved mis-tap can cause, where asking "are you sure?"
   * every time would be worse than offering the way back.
   */
  undo?: () => unknown;
}

export type ToastFn = (message: string, tone?: ToastTone, options?: ToastOptions) => void;

export const ToastContext = createContext<ToastFn>(() => {});

/** `const toast = useToast(); toast('Packed', 'ok')`, or with `{ undo }`. */
export function useToast() {
  return useContext(ToastContext);
}
