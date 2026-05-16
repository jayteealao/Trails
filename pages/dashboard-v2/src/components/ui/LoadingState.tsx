export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-8 h-8 radar-ring">
        <div className="radar-sweep" />
      </div>
      <span className="font-mono text-xs text-text-muted">{message}</span>
    </div>
  );
}
