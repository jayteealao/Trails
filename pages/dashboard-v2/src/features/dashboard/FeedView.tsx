import { useState, useEffect, useCallback, useRef } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { fetchRequests } from '@/api/endpoints';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimeFeedLine, truncateUrl, getDomain } from '@/lib/formatters';
import { FEED_POLL_INTERVAL, FEED_MAX_ITEMS } from '@/lib/constants';
import { useNavigate } from 'react-router';
import type { ArchiveRequest } from '@/api/types';

interface FeedItem extends ArchiveRequest {
  isNew?: boolean;
}

export function FeedView() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connected, setConnected] = useState(true);
  const knownIds = useRef(new Set<string>());
  const navigate = useNavigate();

  const poll = useCallback(async () => {
    try {
      const data = await fetchRequests({ limit: 20 });
      const requests = data.requests ?? [];
      let hasNew = false;

      setItems(prev => {
        const next = [...prev];
        for (const req of requests) {
          if (!knownIds.current.has(req.requestId)) {
            knownIds.current.add(req.requestId);
            next.unshift({ ...req, isNew: true });
            hasNew = true;
          } else {
            const existing = next.find(i => i.requestId === req.requestId);
            if (existing) {
              existing.stage = req.stage;
              existing.errorCount = req.errorCount;
            }
          }
        }

        if (next.length > FEED_MAX_ITEMS) {
          const removed = next.splice(FEED_MAX_ITEMS);
          for (const r of removed) knownIds.current.delete(r.requestId);
        }

        return hasNew ? [...next] : next;
      });

      // Clear isNew flags after animation
      if (hasNew) {
        setTimeout(() => {
          setItems(prev => prev.map(item => ({ ...item, isNew: false })));
        }, 1200);
      }

      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => { poll(); }, [poll]);
  useInterval(poll, FEED_POLL_INTERVAL);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Live Feed</h2>
        <div className="flex items-center gap-2">
          <span className={`led ${connected ? 'led-on' : 'led-error'}`} />
          <span className="font-mono text-[10px] text-text-muted">
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
          <span className="font-mono text-[10px] text-text-muted ml-2">
            {items.length} requests
          </span>
        </div>
      </div>

      <div className="tech-border terminal max-h-[calc(100vh-200px)] overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState message="Waiting for requests..." />
        ) : (
          items.map(item => (
            <div
              key={item.requestId}
              className={`flex items-center gap-3 py-1 px-2 hover:bg-bg-hover cursor-pointer ${
                item.isNew ? 'animate-feed-in' : ''
              }`}
              onClick={() => navigate(`/crawler/requests/${item.requestId}`)}
            >
              <span className="font-mono text-[10px] text-accent-green flex-shrink-0">
                {formatTimeFeedLine(item.createdAt)}
              </span>
              <span className="font-mono text-[10px] text-text-muted flex-shrink-0 w-16">
                {item.requestId.slice(0, 8)}
              </span>
              <StatusBadge status={item.stage} />
              <span className="font-mono text-[10px] text-text-muted flex-shrink-0 w-32 truncate">
                {item.domain || getDomain(item.url)}
              </span>
              <span className="font-mono text-[10px] text-text-secondary truncate">
                {truncateUrl(item.url, 80)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
