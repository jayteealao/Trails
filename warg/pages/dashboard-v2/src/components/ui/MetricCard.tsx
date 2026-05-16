interface MetricCardProps {
  label: string;
  value: string | number;
  variant?: 'default' | 'green' | 'red' | 'amber' | 'cyan';
}

const VARIANT_CLASS: Record<string, string> = {
  default: 'text-text-primary',
  green: 'text-accent-green',
  red: 'text-accent-red',
  amber: 'text-accent-amber',
  cyan: 'text-accent-cyan',
};

export function MetricCard({ label, value, variant = 'default' }: MetricCardProps) {
  return (
    <div className="tech-border p-3">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-1">
        {label}
      </div>
      <div className={`font-mono text-lg font-bold ${VARIANT_CLASS[variant]}`}>
        {value}
      </div>
    </div>
  );
}
