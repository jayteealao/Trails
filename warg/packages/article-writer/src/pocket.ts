/**
 * The `pocket` map of a shared article: the user's Pocket-era fields, copied
 * from the user article that the shared article was made for. Readers declare
 * these types, so the projection stores only strings and numbers.
 */
export interface Pocket {
  favorite: string;
  resolved_id: string;
  status: string;
  time_added: number;
  time_read: number;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Seconds: a finite number, a numeric string, or a Timestamp; anything else is 0. */
function asPocketTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    const date: unknown = value.toDate();
    if (date instanceof Date) return Math.floor(date.getTime() / 1000);
  }
  return 0;
}

/**
 * The one projection of a user article onto the `pocket` map of the shared
 * article `sharedId`. Each field is read from the user article's own `pocket`
 * map when it holds one (the older record of the same fields), else from the
 * app's top-level field. `resolved_id` is never blank: without a usable
 * value it is the shared article's id.
 */
export function projectPocket(userDoc: Record<string, unknown>, sharedId: string): Pocket {
  const nested = userDoc['pocket'];
  const own =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : undefined;
  const resolvedId = own?.['resolved_id'] ?? userDoc['resolvedId'];

  return {
    favorite: asString(own?.['favorite'] ?? userDoc['favorite']),
    resolved_id:
      typeof resolvedId === 'string' && resolvedId.trim().length > 0 ? resolvedId : sharedId,
    status: asString(own?.['status'] ?? userDoc['status']),
    time_added: asPocketTime(own?.['time_added'] ?? userDoc['timeAdded']),
    time_read: asPocketTime(own?.['time_read'] ?? userDoc['timeRead']),
  };
}
