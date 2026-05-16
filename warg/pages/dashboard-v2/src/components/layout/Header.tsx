import { NavLink, useLocation } from 'react-router';
import { useClock } from '@/hooks/useClock';

const NAV_ITEMS = [
  { label: 'DASHBOARD', to: '/dashboard' },
  { label: 'CRAWLER', to: '/crawler' },
  { label: 'DATABASE', to: '/database' },
] as const;

export function Header() {
  const clock = useClock();
  const location = useLocation();

  const section = '/' + (location.pathname.split('/')[1] || 'dashboard');

  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2 bg-bg-surface">
      {/* Branding */}
      <div className="flex items-center gap-4">
        <h1 className="font-display text-sm font-bold tracking-widest text-text-primary">
          ARCHIVE.CORE
        </h1>
        <span className="text-[10px] text-text-muted font-mono tracking-wider">// WARG</span>
        <div className="flex items-center gap-1 ml-2">
          <span className="led led-on" />
          <span className="text-[10px] text-text-muted font-mono">SYS.OK</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={() =>
              `btn-bracket ${section === item.to ? 'active' : ''}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Clock */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-text-muted">{clock}</span>
      </div>
    </header>
  );
}
