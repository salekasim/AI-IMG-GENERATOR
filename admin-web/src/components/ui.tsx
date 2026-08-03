import { type ReactNode } from 'react';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-blue ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted">
      <Spinner className="h-6 w-6" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-red/30 bg-red/10 p-5 text-center">
      <div className="text-red">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-xl border border-line px-4 py-2 text-sm hover:bg-elevated"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  color = 'text-blue',
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: string;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface/70 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className={`${color} text-xl`}>{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'blue' | 'emerald' | 'amber' | 'red' | 'cyan';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-line/60 text-muted',
    blue: 'bg-blue/15 text-blue',
    emerald: 'bg-emerald/15 text-emerald',
    amber: 'bg-amber/15 text-amber',
    red: 'bg-red/15 text-red',
    cyan: 'bg-cyan/15 text-cyan',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-emerald' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-inktext shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-elevated"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Yes, delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  pending,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  pending?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={pending ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red/30 bg-red/15 text-lg text-red">
            ⚠
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-inktext">{title}</h3>
            <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <ActionButton tone="default" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </ActionButton>
          <ActionButton tone="danger" onClick={onConfirm} disabled={pending}>
            {pending ? 'Working…' : confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

export function ActionButton({
  onClick,
  children,
  tone = 'default',
  disabled,
}: {
  onClick?: () => void;
  children: ReactNode;
  tone?: 'default' | 'primary' | 'danger' | 'success';
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    default: 'border border-line bg-elevated text-inktext hover:bg-line',
    primary: 'bg-blue text-inktext shadow-[0_2px_16px_rgba(59,130,246,0.35)] hover:bg-blue/85 hover:shadow-[0_2px_20px_rgba(59,130,246,0.5)]',
    danger: 'bg-red/15 text-red border border-red/30 hover:bg-red/25',
    success: 'bg-emerald/15 text-emerald border border-emerald/30 hover:bg-emerald/25',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-all disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function InlineMessage({
  message,
  tone,
}: {
  message: string;
  tone: 'error' | 'success';
}) {
  if (!message) return null;
  return (
    <div
      className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
        tone === 'error'
          ? 'border-red/30 bg-red/10 text-red'
          : 'border-emerald/30 bg-emerald/10 text-emerald'
      }`}
    >
      {message}
    </div>
  );
}

export function Avatar({ email, name }: { email: string; name: string | null }) {
  const initial = (name?.trim() || email)[0]?.toUpperCase() ?? '?';
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue/20 text-sm font-bold text-blue">
      {initial}
    </span>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}
