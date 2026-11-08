import { DurableObject } from 'cloudflare:workers';
import { LEASE_TTL_MS, isLeaseStale } from '@warg/shared';
import {
  evaluateAcquire,
  type LeaseKind,
  type QuotaLimits,
  type TokenBucket
} from './quota-logic.js';
import { stopStaleContainers, type StaleSandboxLease } from './container-sweep.js';

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
  /** Dropped sandbox leases whose container stop has not run yet. Absent in state written before the sweep moved here. */
  pendingStops?: StaleSandboxLease[];
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
 * Leases auto-expire after the shared LEASE_TTL_MS via alarm. When a
 * sandbox lease expires (its workflow likely crashed before release()), the
 * object queues a stop of its container and, on the alarm, asks monolith
 * (POST /container/stop) to stop it. Failures are logged, not retried;
 * monolith's idle stop stays the backstop. State, including the queued stops,
 * is persisted to DO storage to survive hibernation and eviction.
 *
 * Deploy order: workflow first, then gateway. Between the two deploys the old
 * gateway sweep finds the leases route gone and stops nothing, so one sweeper
 * is active at every point; monolith's stop is idempotent, so any overlap or a
 * replayed queued stop is harmless.
 */
export class BrowserQuotaDO extends DurableObject<Env> {
  private activeLeases: Map<string, Lease> | undefined;
  private bucket: TokenBucket | undefined;
  private pendingStops: StaleSandboxLease[] = [];

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
      this.pendingStops = stored.pendingStops ?? [];
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
      lastRefillMs: this.bucket.lastRefillMs,
      pendingStops: this.pendingStops
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
    const queuedStops = this.cleanupExpiredLeases();

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
      if (decision.bucketChanged || queuedStops > 0) {
        await this.saveState();
      }
      // Run the queued container stops on the alarm, so this RPC never waits on monolith.
      if (queuedStops > 0) {
        this.scheduleCleanup();
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
   * List currently-held sandbox_exec leases: a read-only view (no cleanup, no
   * persistence) of held sandbox leases; no worker calls it over a route.
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

    if (this.pendingStops.length > 0) {
      await this.stopPendingContainers();
    }

    if (this.activeLeases!.size > 0 || this.pendingStops.length > 0) {
      this.scheduleCleanup();
    }
  }

  /**
   * Ask monolith to stop the containers of the queued stale sandbox leases.
   * Works on a snapshot: an acquire may queue more while the stops are in
   * flight, and only the snapshot's entries are removed afterwards. The queue
   * is saved before the stops, so an eviction mid-sweep replays them on the
   * next alarm (stop is idempotent in monolith).
   */
  private async stopPendingContainers(): Promise<void> {
    const snapshot = [...this.pendingStops];
    const summary = await stopStaleContainers(
      this.env.MONOLITH,
      this.env.INTERNAL_API_KEY,
      snapshot,
      'quota-alarm'
    );
    if (summary.failures.length > 0) {
      console.error('[workflow] container sweep partial failures:', JSON.stringify(summary));
    } else {
      console.log('[workflow] container sweep done:', JSON.stringify(summary));
    }

    const handled = new Set(snapshot.map((lease) => lease.leaseId));
    this.pendingStops = this.pendingStops.filter((lease) => !handled.has(lease.leaseId));
    await this.saveState();
  }

  /**
   * Remove stale leases (age at least LEASE_TTL_MS, per the shared
   * isLeaseStale rule). Covers stuck browser and sandbox leases alike; a stale
   * sandbox lease also queues a stop of its container (a browser lease has no
   * container). Returns how many stops it queued.
   */
  private cleanupExpiredLeases(): number {
    const now = Date.now();
    let queued = 0;
    for (const [id, lease] of this.activeLeases!) {
      if (isLeaseStale(lease.acquiredAt, now)) {
        this.activeLeases!.delete(id);
        if (lease.kind === 'sandbox_exec') {
          this.pendingStops.push({
            leaseId: lease.leaseId,
            requestId: lease.requestId,
            acquiredAt: lease.acquiredAt
          });
          queued += 1;
        }
      }
    }
    return queued;
  }

  /**
   * Schedule the cleanup alarm: now when container stops are queued, else one
   * TTL from now.
   */
  private scheduleCleanup(): void {
    const now = Date.now();
    this.ctx.storage.setAlarm(this.pendingStops.length > 0 ? now : now + LEASE_TTL_MS);
  }
}
