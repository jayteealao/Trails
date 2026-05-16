export function EmptyState({ message = 'No data' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <span className="font-mono text-xs text-text-muted">{message}</span>
    </div>
  );
}
