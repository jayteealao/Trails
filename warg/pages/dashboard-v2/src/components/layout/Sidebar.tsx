import { NavLink, useLocation } from 'react-router';

interface SectorItem {
  label: string;
  to: string;
  end?: boolean;
}

const SECTORS: Record<string, SectorItem[]> = {
  dashboard: [
    { label: 'Overview', to: '/dashboard', end: true },
    { label: 'Feed', to: '/dashboard/feed' },
    { label: 'Errors', to: '/dashboard/errors' },
    { label: 'Infra', to: '/dashboard/infra' },
  ],
  crawler: [
    { label: 'Requests', to: '/crawler', end: true },
    { label: 'Backfill', to: '/crawler/backfill' },
  ],
  database: [
    { label: 'Articles', to: '/database', end: true },
  ],
};

export function Sidebar() {
  const location = useLocation();
  const section = location.pathname.split('/')[1] || 'dashboard';
  const items = SECTORS[section] ?? [];

  return (
    <aside className="w-48 border-r border-border bg-bg-surface flex flex-col">
      {/* Section label */}
      <div className="px-3 py-3 border-b border-border">
        <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
          Sector Select
        </span>
      </div>

      {/* Sub-nav */}
      <nav className="flex flex-col py-2">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `sector-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="text-[10px]">&gt;</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* System load placeholders */}
      <div className="mt-auto px-3 py-3 border-t border-border">
        <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-2">
          System
        </div>
        <SystemIndicator label="API" status="ok" />
        <SystemIndicator label="STORE" status="ok" />
        <SystemIndicator label="QUEUE" status="ok" />
      </div>
    </aside>
  );
}

function SystemIndicator({ label, status }: { label: string; status: 'ok' | 'warn' | 'error' }) {
  const ledClass = status === 'ok' ? 'led-on' : status === 'warn' ? 'led-warn' : 'led-error';
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`led ${ledClass}`} />
      <span className="font-mono text-[10px] text-text-muted">{label}</span>
    </div>
  );
}
