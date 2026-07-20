import { describe, expect, it, vi } from "vitest";
import {
  normalizeParticleTransactionStatus,
  readParticleTransactionStatus,
} from "@/lib/ua/particle-finality";
import { MockUAClient } from "@/lib/ua/mock";

const TRANSACTION_ID = "0xparticle-transaction";
const BASE_HASH = `0x${"a".repeat(64)}`;
const ARBITRUM_HASH = `0x${"b".repeat(64)}`;
const PLANNED_USER_OP_HASH = `0x${"c".repeat(64)}`;

const pendingFixture = {
  transactionId: TRANSACTION_ID,
  status: 5,
  depositUserOperations: [
    {
      chainId: 8453,
      status: 1,
      userOpHash: PLANNED_USER_OP_HASH,
    },
  ],
};

const successFixture = {
  transactionId: TRANSACTION_ID,
  status: 7,
  depositUserOperations: [
    {
      chainId: 8453,
      status: 3,
      txHash: BASE_HASH,
      userOpHash: PLANNED_USER_OP_HASH,
    },
  ],
  lendingUserOperations: [
    { chainId: 42161, status: 3, txHash: ARBITRUM_HASH },
  ],
};

describe("Particle transaction finality normalization", () => {
  it("keeps an accepted transaction pending without promoting a userOpHash", () => {
    const result = normalizeParticleTransactionStatus(
      TRANSACTION_ID,
      pendingFixture,
    );

    expect(result).toMatchObject({
      transactionId: TRANSACTION_ID,
      providerStatus: "EXECUTION_PENDING",
      outcome: "pending",
      retrySafe: true,
      error: null,
    });
    expect(result.legs).toEqual([
      expect.objectContaining({
        kind: "source",
        chainId: 8453,
        status: "pending",
        providerStatus: "PENDING",
        confirmedHash: null,
        explorerUrl: null,
      }),
    ]);
    expect(result.raw).toBe(pendingFixture);
  });

  it("normalizes pending then eventual all-leg provider success", () => {
    const pending = normalizeParticleTransactionStatus(
      TRANSACTION_ID,
      pendingFixture,
    );
    const finalized = normalizeParticleTransactionStatus(
      TRANSACTION_ID,
      successFixture,
    );

    expect(pending.outcome).toBe("pending");
    expect(finalized).toMatchObject({
      providerStatus: "FINISHED",
      outcome: "finalized",
      retrySafe: false,
      error: null,
    });
    expect(finalized.legs).toEqual([
      expect.objectContaining({
        kind: "source",
        chainName: "Base",
        status: "finalized",
        confirmedHash: BASE_HASH,
        explorerUrl: `https://basescan.org/tx/${BASE_HASH}`,
      }),
      expect.objectContaining({
        kind: "destination",
        chainName: "Arbitrum",
        status: "finalized",
        confirmedHash: ARBITRUM_HASH,
        explorerUrl: `https://arbiscan.io/tx/${ARBITRUM_HASH}`,
      }),
    ]);
    expect(finalized.raw).toBe(successFixture);
  });

  it("maps source success plus destination failure to partial", () => {
    const fixture = {
      transactionId: TRANSACTION_ID,
      status: 6,
      depositUserOperations: [
        { chainId: 8453, status: 3, txHash: BASE_HASH },
      ],
      lendingUserOperations: [
        {
          chainId: 42161,
          status: 2,
          txHash: ARBITRUM_HASH,
          error: "Bridge execution reverted",
        },
      ],
    };

    const result = normalizeParticleTransactionStatus(
      TRANSACTION_ID,
      fixture,
    );

    expect(result.outcome).toBe("partial");
    expect(result.retrySafe).toBe(false);
    expect(result.legs).toEqual([
      expect.objectContaining({
        status: "finalized",
        confirmedHash: BASE_HASH,
      }),
      expect.objectContaining({
        status: "failed",
        confirmedHash: null,
        explorerUrl: null,
        error: "Bridge execution reverted",
      }),
    ]);
  });

  it("maps a terminal provider failure with no successful leg to failed", () => {
    const result = normalizeParticleTransactionStatus(TRANSACTION_ID, {
      transactionId: TRANSACTION_ID,
      status: "EXECUTION_FAILED",
      depositUserOperations: [
        { chainId: 8453, status: "FAILED", errorMessage: "reverted" },
      ],
      lendingUserOperations: [
        { chainId: 42161, status: 2, reason: "route failed" },
      ],
    });

    expect(result.outcome).toBe("failed");
    expect(result.legs.map((leg) => leg.status)).toEqual(["failed", "failed"]);
    expect(result.legs.every((leg) => leg.confirmedHash === null)).toBe(true);
  });

  it("keeps malformed reads retryable and escalates unknown statuses", () => {
    const malformed = normalizeParticleTransactionStatus(
      TRANSACTION_ID,
      null,
    );
    const unknown = normalizeParticleTransactionStatus(TRANSACTION_ID, {
      transactionId: TRANSACTION_ID,
      status: 99,
    });

    expect(malformed).toMatchObject({
      providerStatus: null,
      outcome: "pending",
      retrySafe: true,
    });
    expect(malformed.raw).toBeNull();
    expect(unknown).toMatchObject({
      providerStatus: "UNKNOWN_99",
      outcome: "needs_attention",
      retrySafe: false,
    });
  });

  it("does not hide a malformed provider leg behind another confirmed leg", () => {
    const result = normalizeParticleTransactionStatus(TRANSACTION_ID, {
      transactionId: TRANSACTION_ID,
      status: 7,
      depositUserOperations: [
        { chainId: 8453, status: 3, txHash: BASE_HASH },
        { status: 3, txHash: ARBITRUM_HASH },
      ],
    });

    expect(result.outcome).toBe("needs_attention");
    expect(result.legs).toEqual([
      expect.objectContaining({
        status: "finalized",
        confirmedHash: BASE_HASH,
      }),
    ]);
  });

  it("does not invent an explorer for an unknown confirmed chain", () => {
    const result = normalizeParticleTransactionStatus(TRANSACTION_ID, {
      transactionId: TRANSACTION_ID,
      status: 7,
      lendingUserOperations: [
        { chainId: 999999, status: 3, txHash: BASE_HASH },
      ],
    });

    expect(result.outcome).toBe("finalized");
    expect(result.legs[0]).toMatchObject({
      chainName: "Chain 999999",
      confirmedHash: BASE_HASH,
      explorerUrl: null,
    });
  });

  it("never treats planned userOps as confirmed execution evidence", () => {
    const fixture = {
      transactionId: TRANSACTION_ID,
      status: 7,
      userOps: [
        {
          chainId: 8453,
          userOpHash: PLANNED_USER_OP_HASH,
          status: 3,
        },
      ],
    };

    const result = normalizeParticleTransactionStatus(
      TRANSACTION_ID,
      fixture,
    );

    expect(result).toMatchObject({
      providerStatus: "FINISHED",
      outcome: "needs_attention",
      retrySafe: false,
    });
    expect(result.legs).toEqual([]);
    expect(result.raw).toBe(fixture);
    expect(JSON.stringify(result)).toContain(PLANNED_USER_OP_HASH);
  });

  it("wraps the SDK getTransaction read behind a typed test seam", async () => {
    const getTransaction = vi.fn().mockResolvedValue(successFixture);

    const result = await readParticleTransactionStatus(
      { getTransaction },
      TRANSACTION_ID,
    );

    expect(getTransaction).toHaveBeenCalledOnce();
    expect(getTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(result.outcome).toBe("finalized");
  });

  it("keeps the credential-free UA implementation deterministic", async () => {
    const ua = new MockUAClient();

    const first = await ua.getTransactionStatus("mock-exec-1");
    const second = await ua.getTransactionStatus("mock-exec-1");

    expect(second).toEqual(first);
    expect(first.outcome).toBe("finalized");
  });
});
