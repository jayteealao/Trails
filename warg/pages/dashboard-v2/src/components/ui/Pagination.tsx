interface PaginationProps {
  info: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function Pagination({ info, canPrev, canNext, onPrev, onNext }: PaginationProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="font-mono text-[10px] text-text-muted">{info}</span>
      <div className="flex gap-1">
        <button
          onClick={onPrev}
          disabled={!canPrev}
          className="btn-tactical text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          PREV
        </button>
        <button
          onClick={onNext}
          disabled={!canNext}
          className="btn-tactical text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          NEXT
        </button>
      </div>
    </div>
  );
}
