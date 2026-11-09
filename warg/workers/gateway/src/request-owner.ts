/**
 * The key a caller authenticated with on /begin: the internal key or the shared public key.
 */
export type CallerKind = 'internal' | 'public';

/**
 * The custom metadata key of the stored options object that records who first started a request id.
 */
export const REQUEST_OWNER_METADATA_KEY = 'owner';

/**
 * The owner of an options object stored before owners were recorded. Every caller of /begin used
 * the public key then, so such an id belongs to the public key, whoever re-runs it first.
 */
export const LEGACY_REQUEST_OWNER: CallerKind = 'public';

/**
 * The recorded owner of a request id: the owner metadata of its stored options object,
 * LEGACY_REQUEST_OWNER for an object stored without one, and undefined when no object exists (a new id).
 */
export function storedRequestIdOwner(
  existing: { customMetadata?: Record<string, string> } | null | undefined
): string | undefined {
  if (!existing) return undefined;
  return existing.customMetadata?.[REQUEST_OWNER_METADATA_KEY] ?? LEGACY_REQUEST_OWNER;
}

/**
 * Who may run a request id again. No stored owner (a new id) gives the id to the caller;
 * the owner itself repeats it; the internal key re-runs any id and keeps its owner.
 * Any other caller is refused.
 */
export function resolveRequestIdOwner(
  storedOwner: string | undefined,
  caller: CallerKind
): { ok: true; owner: string } | { ok: false; storedOwner: string } {
  if (storedOwner === undefined || storedOwner === caller) {
    return { ok: true, owner: caller };
  }
  if (caller === 'internal') {
    return { ok: true, owner: storedOwner };
  }
  return { ok: false, storedOwner };
}
