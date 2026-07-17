import { ConvictionApiError } from "./api-client.js";
import type { LocalWallet } from "./keystore.js";
import {
  acquireAgentLease,
  releaseAgentLease,
  renewAgentLease,
  type LiveLease,
} from "./live-api-client.js";

/** Renew slightly before half the default 120s backend TTL. */
export const DEFAULT_LEASE_HEARTBEAT_MS = 40_000;

export type LeaseLostReason =
  | "lease_conflict"
  | "lease_expired"
  | "renewal_failed"
  | "replaced";

export class LeaseHandle {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lost = false;
  private onLostCallbacks: Array<(reason: LeaseLostReason, error?: Error) => void> =
    [];

  constructor(
    private lease: LiveLease,
    private readonly options: {
      apiBaseUrl: string;
      wallet: LocalWallet;
      fetchImpl?: typeof fetch;
      heartbeatMs?: number;
    },
  ) {}

  get leaseId(): string {
    return this.lease.leaseId;
  }

  get expiresAt(): string {
    return this.lease.expiresAt;
  }

  get isLost(): boolean {
    return this.lost;
  }

  onLost(callback: (reason: LeaseLostReason, error?: Error) => void): void {
    this.onLostCallbacks.push(callback);
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const interval = this.options.heartbeatMs ?? DEFAULT_LEASE_HEARTBEAT_MS;
    this.heartbeatTimer = setInterval(() => {
      void this.renewOnce();
    }, interval);
    // Do not keep the process alive solely for heartbeats.
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Mark the lease invalid and notify listeners (used after displacement). */
  markLost(reason: LeaseLostReason, error?: Error): void {
    if (this.lost) return;
    this.lost = true;
    this.stopHeartbeat();
    for (const callback of this.onLostCallbacks) {
      callback(reason, error);
    }
  }

  async renewOnce(): Promise<void> {
    if (this.lost) return;
    try {
      this.lease = await renewAgentLease({
        apiBaseUrl: this.options.apiBaseUrl,
        wallet: this.options.wallet,
        leaseId: this.lease.leaseId,
        ...(this.options.fetchImpl
          ? { fetchImpl: this.options.fetchImpl }
          : {}),
      });
    } catch (error) {
      if (error instanceof ConvictionApiError) {
        if (error.code === "lease_conflict") {
          this.markLost("replaced", error);
          return;
        }
        if (error.code === "lease_expired") {
          this.markLost("lease_expired", error);
          return;
        }
      }
      this.markLost(
        "renewal_failed",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (this.lost) return;
    try {
      await releaseAgentLease({
        apiBaseUrl: this.options.apiBaseUrl,
        wallet: this.options.wallet,
        leaseId: this.lease.leaseId,
        ...(this.options.fetchImpl
          ? { fetchImpl: this.options.fetchImpl }
          : {}),
      });
    } catch {
      // Best-effort release on shutdown.
    }
  }
}

export async function acquireLeaseHandle(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  replace?: boolean;
  fetchImpl?: typeof fetch;
  heartbeatMs?: number;
}): Promise<LeaseHandle> {
  const lease = await acquireAgentLease({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    ...(options.replace ? { replace: true } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return new LeaseHandle(lease, {
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.heartbeatMs !== undefined
      ? { heartbeatMs: options.heartbeatMs }
      : {}),
  });
}
