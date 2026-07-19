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
});
