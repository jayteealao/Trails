import type { ReactNode } from 'react';

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 pb-3">
      {children}
    </div>
  );
}

export function FilterInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-bg-elevated border border-border px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong w-48"
    />
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-bg-elevated border border-border px-3 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:border-border-strong"
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
