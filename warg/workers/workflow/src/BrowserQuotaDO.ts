import { DurableObject } from 'cloudflare:workers';
import {
  evaluateAcquire,
  type LeaseKind,
  type QuotaLimits,
  type TokenBucket
} from './quota-logic.js';

/**
 * Lease record for an active browser/sandbox session.
 */
interface Lease {
  leaseId: string;
  requestId: string;
  kind: LeaseKind;
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

interface StoredState {
  leases: Array<[string, Lease]>;
  launchTokens: number;
  lastRefillMs: number | undefined;
}

/**
 * Global browser/sandbox quota management Durable Object.
 *
 * Two independent concurrency pools, plus a launch-rate limiter:
 * - Browser pool (`bindings_launch` + `rest_request`): max 100 concurrent
 *   (platform allows 120/account; 100 leaves headroom for other consumers).
 * - Sandbox pool (`sandbox_exec`, monolith): max 6 concurrent — gates the
 *   Cloudflare Sandbox so a backfill batch can't burst-collapse it.
 * - Launch rate: a token bucket modelling the platform's 1 new-browser/sec
 *   fixed fill, with a small burst. Only `bindings_launch` consumes a token.
 *
 * Leases auto-expire after 5 minutes via alarm. State is persisted to DO
 * storage to survive hibernation.
 */
export class BrowserQuotaDO extends DurableObject<Env> {
  private activeLeases: Map<string, Lease> | undefined;
  private bucket: TokenBucket | undefined;

  private readonly LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  private readonly limits: QuotaLimits = {
    maxConcurrent: 100, // platform now 120/account; headroom for other consumers
    maxSandboxConcurrent: 4, // under monolith container max_instances (5); leaves churn slack
    launchRatePerSec: 1, // platform: 1 new browser/sec fixed fill
    launchBurst: 3 // small burst tolerance
  };

  /**
   * Load state from storage (lazy initialization).
   */
  private async loadState(): Promise<void> {
    if (this.activeLeases !== undefined) return;

    const stored = await this.ctx.storage.get<StoredState>('state');

    if (stored) {
      this.activeLeases = new Map(stored.leases);
      this.bucket = {
        tokens: stored.launchTokens ?? this.limits.launchBurst,
        lastRefillMs: stored.lastRefillMs
      };
    } else {
      this.activeLeases = new Map();
      this.bucket = { tokens: this.limits.launchBurst, lastRefillMs: undefined };
    }
  }

  /**
   * Persist state to storage.
   */
  private async saveState(): Promise<void> {
    if (!this.activeLeases || !this.bucket) return;

    const state: StoredState = {
      leases: Array.from(this.activeLeases.entries()),
      launchTokens: this.bucket.tokens,
      lastRefillMs: this.bucket.lastRefillMs
    };
    await this.ctx.storage.put('state', state);
  }

  /**
   * Count currently-held leases of the given kinds.
   */
  private countByKind(...kinds: LeaseKind[]): number {
    let count = 0;
    for (const lease of this.activeLeases!.values()) {
      if (kinds.includes(lease.kind)) count += 1;
    }
    return count;
  }

  /**
   * Attempt to acquire a quota lease.
   * RPC method - called directly from workflow.
   */
  async acquire(kind: LeaseKind, requestId: string): Promise<AcquireResult> {
    await this.loadState();
    this.cleanupExpiredLeases();

    const now = Date.now();
    const decision = evaluateAcquire(
      kind,
      {
        browserActive: this.countByKind('bindings_launch', 'rest_request'),
        sandboxActive: this.countByKind('sandbox_exec'),
        bucket: this.bucket!
      },
      this.limits,
      now
    );

    this.bucket = decision.bucket;

    if (!decision.granted) {
      // Persist the refilled bucket so launch-rate accounting survives
      // hibernation even across denied attempts.
      if (decision.bucketChanged) {
        await this.saveState();
      }
      return { granted: false, retryAfterMs: decision.retryAfterMs };
    }

    const leaseId = crypto.randomUUID();
    this.activeLeases!.set(leaseId, { leaseId, requestId, kind, acquiredAt: now });

    await this.saveState();
    this.scheduleCleanup();

    return { granted: true, leaseId };
  }

  /**
   * List currently-held sandbox_exec leases. Read-only — no cleanup, no
   * persistence. Backs the gateway's orphan-container sweep, which stops the
   * container behind any lease that outlived the TTL (its workflow likely
   * crashed before release()).
   *
   * The returned list is a point-in-time snapshot as of this RPC. Because the
   * DO executes single-threaded the snapshot is internally consistent, but the
   * gateway sweep must treat it as a best-effort hint: leases may be acquired
   * or released between this call and any action the sweep takes.
   */
  async listSandboxLeases(): Promise<
    Array<{ leaseId: string; requestId: string; acquiredAt: number }>
  > {
    await this.loadState();

    const leases: Array<{ leaseId: string; requestId: string; acquiredAt: number }> = [];
    for (const lease of this.activeLeases!.values()) {
      if (lease.kind === 'sandbox_exec') {
        leases.push({
          leaseId: lease.leaseId,
          requestId: lease.requestId,
          acquiredAt: lease.acquiredAt
        });
      }
    }
    return leases;
  }

  /**
   * Release a quota lease.
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
  override async alarm(): Promise<void> {
    await this.loadState();
    this.cleanupExpiredLeases();
    await this.saveState();

    if (this.activeLeases!.size > 0) {
      this.scheduleCleanup();
    }
  }

  /**
   * Remove expired leases (older than LEASE_TTL_MS). Covers stuck browser and
   * sandbox leases alike.
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
   * Schedule the cleanup alarm.
   */
  private scheduleCleanup(): void {
    this.ctx.storage.setAlarm(Date.now() + this.LEASE_TTL_MS);
  }
}
