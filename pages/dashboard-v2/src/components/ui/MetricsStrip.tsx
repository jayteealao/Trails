import { MetricCard } from './MetricCard';

interface MetricDef {
  label: string;
  value: string | number;
  variant?: 'default' | 'green' | 'red' | 'amber' | 'cyan';
}

export function MetricsStrip({ metrics }: { metrics: MetricDef[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map(m => (
        <MetricCard key={m.label} label={m.label} value={m.value} variant={m.variant} />
      ))}
    </div>
  );
}
