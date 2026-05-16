import { useLocation } from 'react-router';
import { useSettings } from '@/hooks/useSettings';

export function RightPanel() {
  const location = useLocation();
  const section = location.pathname.split('/')[1] || 'dashboard';

  return (
    <aside className="w-64 border-l border-border bg-bg-surface flex flex-col overflow-y-auto">
      <div className="px-3 py-3 border-b border-border">
        <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
          System Panel
        </span>
      </div>

      {section === 'dashboard' ? <DashboardPanel /> : null}
      {section === 'crawler' ? <CrawlerPanel /> : null}
      {section === 'database' ? <DatabasePanel /> : null}

      <ConfigPanel />
    </aside>
  );
}

function DashboardPanel() {
  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-2">
        Quick Stats
      </div>
      <div className="font-mono text-[10px] text-text-muted">
        Load data from overview to populate
      </div>
    </div>
  );
}

function CrawlerPanel() {
  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-2">
        Pipeline Status
      </div>
      <div className="font-mono text-[10px] text-text-muted">
        Select a request to view pipeline
      </div>
    </div>
  );
}

function DatabasePanel() {
  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-2">
        Archive Stats
      </div>
      <div className="font-mono text-[10px] text-text-muted">
        Select an article to view archives
      </div>
    </div>
  );
}

function ConfigPanel() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="px-3 py-3 mt-auto">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-3">
        [Config]
      </div>

      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={settings.autoRefresh}
          onChange={e => updateSettings({ autoRefresh: e.target.checked })}
          className="accent-white w-3 h-3"
        />
        <span className="font-mono text-[10px] text-text-secondary">Auto-Refresh</span>
      </label>

      {settings.autoRefresh && (
        <div className="flex items-center gap-2 mb-2 ml-5">
          <span className="font-mono text-[10px] text-text-muted">Interval</span>
          <select
            value={settings.refreshInterval}
            onChange={e => updateSettings({ refreshInterval: Number(e.target.value) })}
            className="bg-bg-elevated border border-border px-1 py-0.5 font-mono text-[10px] text-text-secondary"
          >
            <option value={10}>10s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={settings.jsExecution}
          onChange={e => updateSettings({ jsExecution: e.target.checked })}
          className="accent-white w-3 h-3"
        />
        <span className="font-mono text-[10px] text-text-secondary">JS Execution</span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.imageSave}
          onChange={e => updateSettings({ imageSave: e.target.checked })}
          className="accent-white w-3 h-3"
        />
        <span className="font-mono text-[10px] text-text-secondary">Save Images</span>
      </label>
    </div>
  );
}
