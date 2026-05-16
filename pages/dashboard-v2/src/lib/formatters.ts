import type { FirestoreTimestamp } from '@/api/types';

export function formatTimeShort(timestamp: string | undefined): string {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return String(timestamp);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return String(timestamp);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTimeFeedLine(timestamp: string | undefined): string {
  if (!timestamp) return '--:--:--';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms == null || ms < 0) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes == null || bytes < 0) return '--';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatNumber(n: number | undefined | null): string {
  if (n == null) return '--';
  return n.toLocaleString();
}

export function truncateUrl(url: string | undefined, max = 60): string {
  if (!url) return '';
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + '\u2026';
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

export function formatFirestoreTimestamp(ts: FirestoreTimestamp | string | undefined): string {
  if (!ts) return '--';
  if (typeof ts === 'object' && '_seconds' in ts) {
    return formatTime(new Date(ts._seconds * 1000).toISOString());
  }
  return formatTime(ts);
}
