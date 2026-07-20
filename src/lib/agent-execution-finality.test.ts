import { describe, expect, it } from "vitest";

import {
  createExecutionFinalityRecord,
  type ExecutionFinalityRecord,
  type ExecutionLeg,
  type ExecutionProviderEvidence,
} from "@/lib/agent-execution-finality";
import { MemoryExecutionFinalityStore } from "@/lib/agent-execution-finality-store";

const T0 = "2026-07-19T16:00:00.000Z";
const T1 = "2026-07-19T16:01:00.000Z";
const T2 = "2026-07-19T16:02:00.000Z";

function evidence(
  overrides: Partial<ExecutionProviderEvidence> = {},
): ExecutionProviderEvidence {
  return {
    observedAt: T0,
    attempt: 1,
    providerStatus: "processing",
    normalizedStatus: "pending",
    legId: "source-8453",
    transactionId: null,
    confirmedHash: null,
    error: null,
    raw: { status: "processing", nested: { sequence: [1] } },
    ...overrides,
  };
}

function legs(): ExecutionLeg[] {
  return [
    {
      legId: "source-8453",
      kind: "source",
      chainId: 8453,
      chainName: "Base",
      required: true,
      status: "submitted",
      confirmedHash: null,
      attemptCount: 0,
      lastProviderStatus: null,
      lastError: null,
      submittedAt: T0,
      confirmedAt: null,
      updatedAt: T0,
      providerEvidence: [],
    },
    {
      legId: "destination-42161",
      kind: "destination",
      chainId: 42161,
      chainName: "Arbitrum",
      required: true,
      status: "submitted",
      confirmedHash: null,
      attemptCount: 0,
      lastProviderStatus: null,
      lastError: null,
      submittedAt: T0,
      confirmedAt: null,
      updatedAt: T0,
      providerEvidence: [],
    },
  ];
}

function record(
  overrides: Partial<ExecutionFinalityRecord> = {},
): ExecutionFinalityRecord {
  return {
    ...createExecutionFinalityRecord({
      executionId: "10000000-0000-4000-8000-000000000083",
      agentId: "20000000-0000-4000-8000-000000000083",
      permitId: "30000000-0000-4000-8000-000000000083",
      quoteId: "40000000-0000-4000-8000-000000000083",
      idempotencyKey: "execute-finality-83",
      legs: legs(),
      providerEvidence: [evidence()],
      workflowCorrelationId: "workflow-correlation-83",
      createdAt: T0,
    }),
    ...overrides,
  };
}

describe("MemoryExecutionFinalityStore", () => {
  it("persists records and protects nested leg/provider evidence by cloning", async () => {
    const store = new MemoryExecutionFinalityStore();
    const input = record();
    await store.create(input);

    input.legs[0].status = "failed";
    (
      (input.providerEvidence[0].raw as { nested: { sequence: number[] } })
        .nested.sequence
    ).push(2);

    const firstRead = await store.get(input.executionId);
    expect(firstRead?.legs[0].status).toBe("submitted");
    expect(firstRead?.providerEvidence[0].raw).toEqual({
      status: "processing",
      nested: { sequence: [1] },
    });

    firstRead!.legs[0].providerEvidence.push(evidence());
    const secondRead = await store.get(input.executionId);
    expect(secondRead?.legs[0].providerEvidence).toEqual([]);
  });

  it("uses agent + idempotency as one identity and rejects conflicting bindings", async () => {
    const store = new MemoryExecutionFinalityStore();
    const created = await store.create(record());
    const retry = await store.create(
      record({
        executionId: "10000000-0000-4000-8000-000000000084",
      }),
    );
    expect(retry.executionId).toBe(created.executionId);

    await expect(
      store.create(
        record({
          executionId: "10000000-0000-4000-8000-000000000085",
          permitId: "30000000-0000-4000-8000-000000000085",
        }),
      ),
    ).rejects.toMatchObject({
      field: "agentIdempotency",
    });

    await expect(
      store.create(
        record({
          executionId: "10000000-0000-4000-8000-000000000086",
          agentId: "20000000-0000-4000-8000-000000000086",
          idempotencyKey: "another-key",
          quoteId: "40000000-0000-4000-8000-000000000086",
        }),
      ),
    ).rejects.toMatchObject({
      field: "permitId",
    });
  });

  it("atomically binds and looks up a Particle transaction exactly once", async () => {
    const store = new MemoryExecutionFinalityStore();
    const created = await store.create(record());
    expect(await store.getByParticleTransactionId("particle-tx-83")).toBeNull();

    const bound = await store.bindParticleTransaction({
      executionId: created.executionId,
      expectedVersion: 1,
      particleTransactionId: "particle-tx-83",
      updatedAt: T1,
    });
    expect(bound).toMatchObject({
      particleTransactionId: "particle-tx-83",
      version: 2,
      updatedAt: T1,
    });
    expect(
      await store.getByParticleTransactionId("particle-tx-83"),
    ).toMatchObject({ executionId: created.executionId });

    expect(
      await store.bindParticleTransaction({
        executionId: created.executionId,
        expectedVersion: 1,
        particleTransactionId: "particle-tx-stale",
        updatedAt: T2,
      }),
    ).toBeNull();

    await expect(
      store.bindParticleTransaction({
        executionId: created.executionId,
        expectedVersion: 2,
        particleTransactionId: "particle-tx-other",
        updatedAt: T2,
      }),
    ).rejects.toMatchObject({
      field: "particleTransactionId",
    });

    const second = await store.create(
      record({
        executionId: "10000000-0000-4000-8000-000000000087",
        agentId: "20000000-0000-4000-8000-000000000087",
        permitId: "30000000-0000-4000-8000-000000000087",
        quoteId: "40000000-0000-4000-8000-000000000087",
        idempotencyKey: "execute-finality-87",
      }),
    );
    await expect(
      store.bindParticleTransaction({
        executionId: second.executionId,
        expectedVersion: 1,
        particleTransactionId: "particle-tx-83",
        updatedAt: T2,
      }),
    ).rejects.toMatchObject({
      field: "particleTransactionId",
    });
  });

  it("permits only legal state changes and applies them with versioned CAS", async () => {
    const store = new MemoryExecutionFinalityStore();
    const created = await store.create(record());
    const pending = await store.transition({
      executionId: created.executionId,
      expectedVersion: 1,
      from: "submitted",
      to: "pending",
      updatedAt: T1,
      patch: {
        attemptCount: 1,
        lastProviderStatus: "processing",
        providerEvidence: [evidence()],
      },
    });
    expect(pending).toMatchObject({
      outcome: "pending",
      attemptCount: 1,
      version: 2,
    });

    expect(
      await store.transition({
        executionId: created.executionId,
        expectedVersion: 1,
        from: "submitted",
        to: "failed",
        updatedAt: T2,
      }),
    ).toBeNull();

    await expect(
      store.transition({
        executionId: created.executionId,
        expectedVersion: 2,
        from: "pending",
        to: "submitted",
        updatedAt: T2,
      }),
    ).rejects.toThrow("Illegal execution transition pending -> submitted");

    await expect(
      store.transition({
        executionId: created.executionId,
        expectedVersion: 2,
        from: "pending",
        to: "pending",
        updatedAt: T2,
        patch: { providerEvidence: [] },
      }),
    ).rejects.toThrow("provider evidence cannot be removed");

    const finalizedLegs = pending!.legs.map((leg, index) => ({
      ...leg,
      status: "finalized" as const,
      confirmedHash: `0xconfirmed${index}`,
      confirmedAt: T2,
      updatedAt: T2,
    }));
    const finalized = await store.transition({
      executionId: created.executionId,
      expectedVersion: 2,
      from: "pending",
      to: "finalized",
      updatedAt: T2,
      patch: { legs: finalizedLegs },
    });
    expect(finalized).toMatchObject({
      outcome: "finalized",
      finalizedAt: T2,
      version: 3,
    });
    await expect(
      store.transition({
        executionId: created.executionId,
        expectedVersion: 3,
        from: "finalized",
        to: "pending",
        updatedAt: T2,
      }),
    ).rejects.toThrow("Illegal execution transition finalized -> pending");
  });

  it("requires actionable recovery guidance for needs_attention", async () => {
    const store = new MemoryExecutionFinalityStore();
    const created = await store.create(record());
    await expect(
      store.transition({
        executionId: created.executionId,
        expectedVersion: 1,
        from: "submitted",
        to: "needs_attention",
        updatedAt: T1,
      }),
    ).rejects.toThrow("requires operator recovery guidance");

    const escalated = await store.transition({
      executionId: created.executionId,
      expectedVersion: 1,
      from: "submitted",
      to: "needs_attention",
      updatedAt: T1,
      patch: {
        lastProviderStatus: "destination_failed",
        lastError: "Destination leg did not settle.",
        operatorRecovery: {
          summary: "Source funds moved but the destination did not settle.",
          affectedLegIds: ["destination-42161"],
          steps: [
            "Inspect the Particle transaction and destination explorer.",
            "Recover or route the stranded value without re-submitting.",
          ],
        },
      },
    });
    expect(escalated?.operatorRecovery?.affectedLegIds).toEqual([
      "destination-42161",
    ]);
  });

  it("exports and imports durable state with indexes and CAS intact", async () => {
    const beforeRestart = new MemoryExecutionFinalityStore();
    const created = await beforeRestart.create(record());
    const bound = await beforeRestart.bindParticleTransaction({
      executionId: created.executionId,
      expectedVersion: 1,
      particleTransactionId: "particle-restart-83",
      updatedAt: T1,
    });
    const exported = beforeRestart.exportState();

    const afterRestart = new MemoryExecutionFinalityStore(exported);
    (
      (exported.records[0].providerEvidence[0].raw as {
        nested: { sequence: number[] };
      }).nested.sequence
    ).push(99);

    expect(
      await afterRestart.getByAgentIdempotency(
        created.agentId,
        created.idempotencyKey,
      ),
    ).toMatchObject({ executionId: created.executionId, version: 2 });
    expect(
      await afterRestart.getByPermitId(created.permitId),
    ).toMatchObject({ executionId: created.executionId });
    expect(
      await afterRestart.getByQuoteId(created.quoteId),
    ).toMatchObject({ executionId: created.executionId });
    expect(
      await afterRestart.getByParticleTransactionId("particle-restart-83"),
    ).toMatchObject({ executionId: created.executionId });

    const pending = await afterRestart.transition({
      executionId: created.executionId,
      expectedVersion: bound!.version,
      from: "submitted",
      to: "pending",
      updatedAt: T2,
      patch: { attemptCount: 1 },
    });
    expect(pending).toMatchObject({ outcome: "pending", version: 3 });
    expect(pending?.providerEvidence[0].raw).toEqual({
      status: "processing",
      nested: { sequence: [1] },
    });
  });
});
