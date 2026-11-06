'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'info' | 'ok' | 'warn' | 'error';
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  push(toast: Omit<Toast, 'id'>): void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

const TONE: Record<ToastTone, string> = {
  info: 'border-accent/30',
  ok: 'border-ok/40',
  warn: 'border-warn/40',
  error: 'border-bad/40',
};
const DOT: Record<ToastTone, string> = { info: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', error: 'bg-bad' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.tone === 'error' ? 9_000 : 5_000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} role="status" className={cn('pointer-events-auto flex gap-3 rounded-lg border bg-ink-800/95 px-4 py-3 shadow-panel backdrop-blur', TONE[toast.tone])}>
            <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', DOT[toast.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{toast.title}</p>
              {toast.description && <p className="mt-0.5 text-xs text-fg-muted">{toast.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(toast.id)} className="text-xs text-fg-subtle hover:text-fg" aria-label="Dismiss notification">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
