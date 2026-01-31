import { DurableObject } from 'cloudflare:workers';

/**
 * Lease record for an active browser session.
 */
interface Lease {
  leaseId: string;
  requestId: string;
  kind: 'bindings_launch' | 'rest_request';
  acquiredAt: number;
}

/**
 * Result of a quota acquisition attempt.
 */
export interface AcquireResult {
  granted: boolean;
  leaseId?: string;
  retryAfterMs?: number;
}

/**
 * Global browser quota management Durable Object.
 *
 * Enforces Workers Paid limits:
 * - Max 30 concurrent browser instances
 * - Max 30 new browser launches per minute (rolling window)
 * - Leases auto-expire after 5 minutes via alarm
 *
 * State is persisted to DO storage to survive hibernation.
 */
export class BrowserQuotaDO extends DurableObject<Env> {
  private activeLeases: Map<string, Lease> | undefined;
  private launchTimestamps: number[] | undefined;

  private readonly MAX_CONCURRENT = 30;
  private readonly MAX_PER_MINUTE = 30;
  private readonly LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Load state from storage (lazy initialization).
   */
  private async loadState(): Promise<void> {
    if (this.activeLeases !== undefined) return;

    const stored = await this.ctx.storage.get<{
      leases: Array<[string, Lease]>;
      timestamps: number[];
    }>('state');

    if (stored) {
      this.activeLeases = new Map(stored.leases);
      this.launchTimestamps = stored.timestamps;
    } else {
      this.activeLeases = new Map();
      this.launchTimestamps = [];
    }
  }

  /**
   * Persist state to storage.
   */
  private async saveState(): Promise<void> {
    if (!this.activeLeases || !this.launchTimestamps) return;

    await this.ctx.storage.put('state', {
      leases: Array.from(this.activeLeases.entries()),
      timestamps: this.launchTimestamps
    });
  }

  /**
   * Attempt to acquire a browser quota lease.
   * RPC method - called directly from workflow.
   */
  async acquire(
    kind: 'bindings_launch' | 'rest_request',
    requestId: string
  ): Promise<AcquireResult> {
    await this.loadState();
    this.cleanupExpiredLeases();
    this.pruneOldTimestamps();

    const now = Date.now();

    // For bindings_launch, enforce both concurrent and per-minute limits
    if (kind === 'bindings_launch') {
      // Check concurrent limit
      if (this.activeLeases!.size >= this.MAX_CONCURRENT) {
        return { granted: false, retryAfterMs: 5000 };
      }

      // Check per-minute limit
      if (this.launchTimestamps!.length >= this.MAX_PER_MINUTE) {
        const oldest = this.launchTimestamps![0];
        if (oldest !== undefined) {
          const waitMs = 60000 - (now - oldest) + 100;
          return { granted: false, retryAfterMs: Math.max(waitMs, 100) };
        }
      }

      // Record this launch timestamp
      this.launchTimestamps!.push(now);
    }

    // Grant the lease
    const leaseId = crypto.randomUUID();
    this.activeLeases!.set(leaseId, {
      leaseId,
      requestId,
      kind,
      acquiredAt: now
    });

    // Persist state and schedule cleanup
    await this.saveState();
    this.scheduleCleanup();

    return { granted: true, leaseId };
  }

  /**
   * Release a browser quota lease.
   * RPC method - called directly from workflow.
   * Idempotent - safe to call multiple times with same leaseId.
   */
  async release(leaseId: string): Promise<void> {
    await this.loadState();
    this.activeLeases!.delete(leaseId);
    await this.saveState();
  }

  /**
   * Alarm handler for cleaning up expired leases.
   */
  async alarm(): Promise<void> {
    await this.loadState();
    this.cleanupExpiredLeases();
    await this.saveState();

    if (this.activeLeases!.size > 0) {
      this.scheduleCleanup();
    }
  }

  /**
   * Remove expired leases (older than LEASE_TTL_MS).
   */
  private cleanupExpiredLeases(): void {
    const now = Date.now();
    for (const [id, lease] of this.activeLeases!) {
      if (now - lease.acquiredAt > this.LEASE_TTL_MS) {
        this.activeLeases!.delete(id);
      }
    }
  }

  /**
   * Remove timestamps older than 60 seconds.
   */
  private pruneOldTimestamps(): void {
    const cutoff = Date.now() - 60000;
    this.launchTimestamps = this.launchTimestamps!.filter((ts) => ts > cutoff);
  }

  /**
   * Schedule the cleanup alarm.
   */
  private scheduleCleanup(): void {
    this.ctx.storage.setAlarm(Date.now() + this.LEASE_TTL_MS);
  }
}
