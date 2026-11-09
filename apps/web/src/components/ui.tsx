import clsx from 'clsx';
import { Search, Users } from 'lucide-react';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx('rounded-xl border border-dark-border bg-dark-card', className)}>{children}</div>;
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-cyan text-dark-bg hover:bg-brand-cyan/90',
        variant === 'secondary' && 'border border-dark-border bg-dark-hover text-content-primary hover:border-brand-cyan/40',
        variant === 'ghost' && 'text-content-secondary hover:bg-dark-hover hover:text-content-primary',
        variant === 'danger' && 'border border-brand-error/40 bg-brand-error/10 text-brand-error hover:bg-brand-error/20',
        className,
      )}
    />
  );
}

export function Avatar({ name }: { name: string | null }) {
  const letter = (name ?? '').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase();
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dark-hover text-sm font-semibold text-brand-cyan">
      {letter || <Users size={16} className="text-content-muted" />}
    </div>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <input
      type="checkbox"
      title={title}
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate) && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer accent-[#22D3EE] disabled:cursor-not-allowed disabled:opacity-30"
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  right,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3', className)}>
      <Search size={16} className="shrink-0 text-content-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-content-muted"
      />
      {right}
    </div>
  );
}
