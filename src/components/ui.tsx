import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContext } from './toastContext';
import type { ToastTone } from './toastContext';

/** Shared building blocks, all sized for thumbs rather than mouse pointers. */

/* ---------------------------------------------------------------- toasts -- */

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'ok') => {
    seq.current += 1;
    const toast = { id: seq.current, message, tone };
    setToasts((current) => [...current, toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== toast.id));
    }, 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.tone === 'ok' ? '' : ` toast-${toast.tone}`}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------------------------------------------------------- sheets -- */

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Escape closes, and the body is locked so the page behind cannot scroll.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Yes/no confirmation, used before anything destructive. */
export function ConfirmSheet({
  title,
  body,
  confirmLabel = 'Confirm',
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="small">{body}</div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- stepper -- */

/**
 * Quantity control. The +/- buttons are 44px so they can be hit without
 * looking; the field itself accepts typing for big numbers.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next));

  return (
    <div className="stepper" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`Decrease ${label ?? 'quantity'}`}
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label ?? 'Quantity'}
        value={draft ?? String(value)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null) {
            const parsed = Number(draft);
            onChange(Number.isFinite(parsed) ? clamp(parsed) : value);
            setDraft(null);
          }
        }}
      />
      <button
        type="button"
        aria-label={`Increase ${label ?? 'quantity'}`}
        onClick={() => onChange(clamp(value + step))}
        disabled={max !== undefined && value >= max}
      >
        +
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces -- */

export function Pill({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';
  children: ReactNode;
}) {
  return <span className={`pill${tone === 'default' ? '' : ` pill-${tone}`}`}>{children}</span>;
}

export function ProgressBar({ percent, done }: { percent: number; done?: boolean }) {
  return (
    <div
      className={`progress${done ? ' progress-done' : ''}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function EmptyState({
  glyph = '📦',
  title,
  body,
  action,
}: {
  glyph?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="glyph">{glyph}</span>
      <h3>{title}</h3>
      {body ? <p className="small">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint ? <span className="tiny muted">{hint}</span> : null}
    </div>
  );
}

/** Horizontal filter chips. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="chip-row" role="group">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="chip"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}
