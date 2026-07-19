import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExecutionFinalityRecord,
  MemoryExecutionFinalityStore,
  type ExecutionFinalityRecord,
} from "@/lib/agent-execution-finality";
import { MemoryAgentQuoteStore } from "@/lib/agent-quote";
import { MemoryAgentRetirementStore } from "@/lib/agent-retirement";

const state = vi.hoisted(() => ({
  ownerUserId: "did:privy:owner-83",
  agent: null as Record<string, unknown> | null,
  executionStore: null as MemoryExecutionFinalityStore | null,
  retirementStore: null as MemoryAgentRetirementStore | null,
  quoteStore: null as MemoryAgentQuoteStore | null,
  getTransactionStatus: vi.fn(),
  quoteTrade: vi.fn(),
  executeTrade: vi.fn(),
  quoteWithdrawal: vi.fn(),
  executeWithdrawal: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@/lib/agent-policy-route", () => ({
  async getOperatorPolicyContext() {
    return {
      ownerUserId: state.ownerUserId,
      store: {
        async findNonRetiredByOwner() {
          return state.agent;
        },
      },
      auditStore: {},
      permitStore: {},
      spendLedger: {},
    };
  },
  operatorPolicyErrorResponse(error: { code?: string; message?: string }) {
    return Response.json(
      {
        error: {
          code: error.code ?? "unavailable",
          message: error.message ?? "unavailable",
        },
      },
      { status: error.code === "agent_not_found" ? 404 : 409 },
    );
  },
}));

vi.mock("@/lib/agent-execution-finality-store", () => ({
  getExecutionFinalityStore: () => state.executionStore,
}));

vi.mock("@/lib/agent-retirement-store", () => ({
  getAgentRetirementStore: () => state.retirementStore,
}));

vi.mock("@/lib/agent-quote-store", () => ({
  getAgentQuoteStore: () => state.quoteStore,
}));

vi.mock("@/lib/ua", () => ({
  getUAClient: () => ({
    getTransactionStatus: state.getTransactionStatus,
    quoteTrade: state.quoteTrade,
    executeTrade: state.executeTrade,
    quoteWithdrawal: state.quoteWithdrawal,
    executeWithdrawal: state.executeWithdrawal,
  }),
}));

vi.mock("@/lib/agent-execution-workflow", () => ({
  settleReconciledExecution: state.settle,
}));

import { GET } from "@/app/api/agents/finality/route";
import { POST } from "@/app/api/agents/finality/retry/route";

const AGENT_ID = "10000000-0000-4000-8000-000000000083";
const EXECUTION_ID = "20000000-0000-4000-8000-000000000083";
const NOW = "2026-07-19T19:00:00.000Z";

function pendingExecution(): ExecutionFinalityRecord {
  return createExecutionFinalityRecord({
    executionId: EXECUTION_ID,
    agentId: AGENT_ID,
    permitId: "30000000-0000-4000-8000-000000000083",
    quoteId: "40000000-0000-4000-8000-000000000083",
    idempotencyKey: "route-finality-83",
    particleTransactionId: "particle-route-83",
    outcome: "pending",
    legs: [
      {
        legId: "destination:42161:0",
        kind: "destination",
        chainId: 42161,
        chainName: "Arbitrum",
        required: true,
        status: "pending",
        confirmedHash: null,
        attemptCount: 0,
        lastProviderStatus: "PENDING",
        lastError: null,
        submittedAt: NOW,
        confirmedAt: null,
        updatedAt: NOW,
        providerEvidence: [],
      },
    ],
    createdAt: NOW,
  });
}

describe("operator finality routes", () => {
  beforeEach(async () => {
    state.ownerUserId = "did:privy:owner-83";
    state.agent = {
      agentId: AGENT_ID,
      ownerUserId: state.ownerUserId,
      address: "0x1111111111111111111111111111111111111111",
    };
    state.executionStore = new MemoryExecutionFinalityStore();
    await state.executionStore.create(pendingExecution());
    state.retirementStore = new MemoryAgentRetirementStore();
    state.quoteStore = new MemoryAgentQuoteStore();
    state.getTransactionStatus.mockReset();
    state.quoteTrade.mockReset();
    state.executeTrade.mockReset();
    state.quoteWithdrawal.mockReset();
    state.executeWithdrawal.mockReset();
    state.settle.mockReset();
    state.getTransactionStatus.mockResolvedValue({
      transactionId: "particle-route-83",
      providerStatus: "EXECUTION_PENDING",
      outcome: "pending",
      legs: [],
      retrySafe: true,
      error: null,
      raw: null,
    });
    state.settle.mockImplementation(
      async (record: ExecutionFinalityRecord) => record,
    );
  });

  it("lists/views only the signed-in operator's execution", async () => {
    const list = await GET(
      new Request("https://conviction.test/api/agents/finality"),
    );
    expect(list.status).toBe(200);
    expect((await list.json()).executions).toHaveLength(1);

    state.ownerUserId = "did:privy:other";
    state.agent = {
      agentId: "10000000-0000-4000-8000-000000000084",
      ownerUserId: state.ownerUserId,
      address: "0x2222222222222222222222222222222222222222",
    };
    const denied = await GET(
      new Request(
        `https://conviction.test/api/agents/finality?executionId=${EXECUTION_ID}`,
      ),
    );
    expect(denied.status).toBe(404);
  });

  it("retries only status reconciliation and idempotent settlement", async () => {
    const response = await POST(
      new Request("https://conviction.test/api/agents/finality/retry", {
        method: "POST",
        body: JSON.stringify({
          agentId: AGENT_ID,
          resourceType: "execution",
          resourceId: EXECUTION_ID,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(state.getTransactionStatus).toHaveBeenCalledTimes(1);
    expect(state.settle).toHaveBeenCalledTimes(1);
    expect(state.quoteTrade).not.toHaveBeenCalled();
    expect(state.executeTrade).not.toHaveBeenCalled();
    expect(state.quoteWithdrawal).not.toHaveBeenCalled();
    expect(state.executeWithdrawal).not.toHaveBeenCalled();
    expect((await response.json()).status.mode).toBe("reconciling");
  });
});
