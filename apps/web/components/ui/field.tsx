import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Field({ id, label, hint, error, children, trailing }: { id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-fg-muted">{label}</label>
        {trailing && <div className="text-xs text-fg-subtle">{trailing}</div>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-bad">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 text-sm text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; suffix?: ReactNode }>(function Input(
  { className, invalid, suffix, ...props },
  ref,
) {
  return (
    <div className="relative">
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        aria-describedby={props.id ? `${props.id}-${invalid ? 'error' : 'hint'}` : undefined}
        className={cn(control, 'h-11', suffix && 'pr-16', invalid && 'border-bad/60', className)}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle">{suffix}</span>}
    </div>
  );
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-11 appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode; disabled?: boolean }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-ink-600 bg-ink-900 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-9 rounded-md text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
            value === option.value ? 'bg-ink-700 text-fg' : 'text-fg-subtle hover:text-fg',
            option.disabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
