export function Footer() {
  return (
    <footer className="flex items-center justify-between border-t border-border px-4 py-1.5 bg-bg-surface">
      <div className="flex items-center gap-3">
        <span className="led led-on" />
        <span className="font-mono text-[10px] text-text-muted">
          SIGNAL.NOMINAL
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="font-mono text-[10px] text-text-muted">
          WARG v2.0
        </span>
        <span className="font-mono text-[10px] text-text-muted">
          CF.EDGE
        </span>
      </div>
    </footer>
  );
}
