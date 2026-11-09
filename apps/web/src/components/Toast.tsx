import { createContext, useCallback, useContext, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

/** `const toast = useToast(); toast('Salvo!', 'success')` */
export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = nextId++;
      setItems((list) => [...list.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-xl backdrop-blur',
              t.kind === 'success' && 'border-brand-success/40 bg-[#0f1f16]/95 text-brand-success',
              t.kind === 'error' && 'border-brand-error/40 bg-[#2a1012]/95 text-brand-error',
              t.kind === 'info' && 'border-dark-border bg-dark-card/95 text-content-primary',
            )}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : t.kind === 'error' ? (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            ) : (
              <Info size={16} className="mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

