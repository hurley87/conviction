import { describe, expect, it } from "vitest";

import { resetAgentAuditStoreForTests, getAgentAuditStore } from "@/lib/agent-audit";
import {
  getAgentNotificationStore,
  resetAgentNotificationStoreForTests,
} from "@/lib/agent-notifications";
import { emitOperatorEvent } from "@/lib/agent-operator-events";

describe("emitOperatorEvent", () => {
  it("projects trade, back, and escalation into one audit + one notification each", async () => {
    resetAgentAuditStoreForTests();
    resetAgentNotificationStoreForTests();

    emitOperatorEvent({
      type: "trade_executed",
      agentId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      receiptId: "rcpt-1",
      transactionId: "tx-1",
      summary: "Bought ETH",
    });
    emitOperatorEvent({
      type: "back_executed",
      agentId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      receiptId: "rcpt-2",
      backRecordId: "00000000-0000-4000-8000-0000000000bb",
      reconciliationState: "pending_sync",
    });
    emitOperatorEvent({
      type: "reconciliation_escalated",
      agentId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      resource: "back",
      resourceId: "00000000-0000-4000-8000-0000000000bb",
      backRecordId: "00000000-0000-4000-8000-0000000000bb",
      receiptId: "rcpt-2",
      error: "attribution unavailable",
    });

    // Allow microtask projections to settle.
    await Promise.resolve();
    await Promise.resolve();

    const notifications = await getAgentNotificationStore().listByOwner("user-1");
    const audits = await getAgentAuditStore().listByAgent(
      "00000000-0000-4000-8000-000000000001",
    );

    expect(notifications.map((n) => n.kind).sort()).toEqual([
      "back_success",
      "reconciliation_needs_attention",
      "trade_success",
    ]);
    expect(audits.map((a) => a.type).sort()).toEqual([
      "back",
      "execute_result",
      "reconciliation_needs_attention",
    ]);

    // Idempotent escalation
    emitOperatorEvent({
      type: "reconciliation_escalated",
      agentId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      resource: "back",
      resourceId: "00000000-0000-4000-8000-0000000000bb",
      backRecordId: "00000000-0000-4000-8000-0000000000bb",
      error: "attribution unavailable",
    });
    await Promise.resolve();
    await Promise.resolve();
    const again = await getAgentNotificationStore().listByOwner("user-1");
    expect(
      again.filter((n) => n.kind === "reconciliation_needs_attention"),
    ).toHaveLength(1);
  });

  it("deduplicates detailed execution and retirement finality alerts", async () => {
    resetAgentAuditStoreForTests();
    resetAgentNotificationStoreForTests();
    const executionEvent = {
      type: "execution_finality_attention" as const,
      agentId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      executionId: "execution-83",
      transactionId: "particle-83",
      outcome: "partial" as const,
      affectedLeg: {
        legId: "destination:42161:0",
        kind: "destination",
        chainName: "Arbitrum",
        status: "failed",
        lastProviderStatus: "EXECUTION_FAILED",
        confirmedHash: null,
        error: "destination reverted",
      },
      lastProviderStatus: "EXECUTION_FAILED",
      workflowRunId: "workflow-83",
      correlationId: "correlation-83",
      recoveryPath:
        "Inspect the unresolved destination and do not resubmit the transaction.",
    };
    const retirementEvent = {
      type: "retirement_finality_attention" as const,
      agentId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      retirementId: "00000000-0000-4000-8000-000000000083",
      transactionId: "particle-retirement-83",
      affectedLeg: {
        legId: "conversion:eth:Base",
        kind: "conversion",
        status: "needs_attention",
        lastProviderStatus: "EXECUTION_FAILED",
        confirmedHash: null,
        error: "conversion destination failed",
      },
      workflowRunId: "retirement-workflow-83",
      recoveryPath:
        "Use conviction-mcp retire --profile <name> with the original local signer.",
    };

    emitOperatorEvent(executionEvent);
    emitOperatorEvent(executionEvent);
    emitOperatorEvent(retirementEvent);
    emitOperatorEvent(retirementEvent);
    await Promise.resolve();
    await Promise.resolve();

    const notifications =
      await getAgentNotificationStore().listByOwner("user-1");
    expect(notifications).toHaveLength(2);
    const execution = notifications.find((item) =>
      item.dedupeKey.startsWith("execution:"),
    );
    expect(execution).toMatchObject({ severity: "warning" });
    expect(execution?.body).toContain("particle-83");
    expect(execution?.body).toContain("destination:42161:0");
    expect(execution?.body).toContain("EXECUTION_FAILED");
    expect(execution?.body).toContain("do not resubmit");

    const retirement = notifications.find((item) =>
      item.dedupeKey.startsWith("retirement:"),
    );
    expect(retirement).toMatchObject({ severity: "critical" });
    expect(retirement?.body).toContain(
      "00000000-0000-4000-8000-000000000083",
    );
    expect(retirement?.body).toContain("conversion:eth:Base");
    expect(retirement?.body).toContain("original local signer");
  });
});
