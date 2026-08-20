import { createContext, useContext } from 'react';

/**
 * Toast plumbing, kept apart from the components that use it so both modules
 * stay fast-refresh friendly.
 */

export type ToastTone = 'ok' | 'error' | 'warn';

export const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

/** `const toast = useToast(); toast('Packed', 'ok')` */
export function useToast() {
  return useContext(ToastContext);
}
