// @ts-check

/** @param {string|null|undefined} str @returns {string} */
export function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** @param {string} url @param {number} [max] @returns {string} */
export function truncateUrl(url, max = 60) {
  if (!url || url.length <= max) return url || '';
  return url.slice(0, max - 1) + '\u2026';
}

/** @param {string|null|undefined} timestamp @returns {string} */
export function formatTimeShort(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return /** @type {string} */ (timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** @param {string|null|undefined} timestamp @returns {string} */
export function formatTimeFeedLine(timestamp) {
  if (!timestamp) return '--:--:--';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** @param {number|null|undefined} ms @returns {string} */
export function formatDuration(ms) {
  if (ms == null || ms < 0) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** @param {string|null|undefined} timestamp @returns {string} */
export function formatTime(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return /** @type {string} */ (timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 86400000) {
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** @param {number|null|undefined} bytes @returns {string} */
export function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return '--';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** @param {number|null|undefined} n @returns {string} */
export function formatNumber(n) {
  if (n == null) return '--';
  return n.toLocaleString();
}

/**
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** @param {string} url @returns {string} */
export function getDomain(url) {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

/**
 * Convert a date-range preset string to { from, to } ISO strings.
 * Returns empty object for no filtering.
 * @param {string} range
 * @returns {{ from?: string, to?: string }}
 */
export function dateRangeToParams(range) {
  if (!range) return {};
  const now = new Date();
  const to = now.toISOString();
  /** @type {Record<string, number>} */
  const offsets = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
  const ms = offsets[range];
  if (!ms) return {};
  return { from: new Date(now.getTime() - ms).toISOString(), to };
}
