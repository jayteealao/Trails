// Signed archive links reused per object path until shortly before they expire,
// so a repeated request makes no remote signing call. The cache is per function
// instance (in memory); an instance that has not signed a path signs it once.

/** A cached link is reused only while more than this much of its life is left. */
export const SIGNED_LINK_REUSE_MARGIN_MS = 5 * 60 * 1000;

export interface CachedSignedLink {
  url: string;
  expiresAtMs: number;
}

export class SignedLinkCache {
  // A Map keeps insertion order, so the first key is the oldest entry.
  private readonly entries = new Map<string, CachedSignedLink>();

  constructor(private readonly maxEntries = 500) {}

  get size(): number {
    return this.entries.size;
  }

  /** The cached link for the path when more than the reuse margin is left. */
  get(objectPath: string, nowMs: number): CachedSignedLink | undefined {
    const hit = this.entries.get(objectPath);
    if (!hit) return undefined;
    if (hit.expiresAtMs - nowMs > SIGNED_LINK_REUSE_MARGIN_MS) return hit;
    this.entries.delete(objectPath);
    return undefined;
  }

  set(objectPath: string, url: string, expiresAtMs: number, nowMs = Date.now()): void {
    this.entries.delete(objectPath);
    this.entries.set(objectPath, { url, expiresAtMs });
    for (const [path, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) this.entries.delete(path);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** The cache both signed-link routes use with the production signer. */
export const sharedSignedLinkCache = new SignedLinkCache();
