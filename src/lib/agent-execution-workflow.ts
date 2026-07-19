import "server-only";

import {
  createExecutionReconciler,
  runExecutionReconciliationRetries,
  type ExecutionWorkflowStarter,
} from "@/lib/agent-execution-reconciliation";
import type { ExecutionFinalityRecord } from "@/lib/agent-execution-finality";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { getAgentAuditStore } from "@/lib/agent-audit";
import {
  createBackWorkflowStarter,
  createConvictionBackAttributionApplier,
} from "@/lib/agent-back-attribution";
import { getAgentBackRecordStore } from "@/lib/agent-back-store";
import { settleExecutionFinality } from "@/lib/agent-permit";
import {
  getAgentExecuteIdempotencyStore,
  getAgentPermitStore,
  getAgentReceiptPersist,
  getAgentSpendLedger,
} from "@/lib/agent-permit-store";
import { commitAgentSpend } from "@/lib/agent-policy";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getAgentQuoteStore } from "@/lib/agent-quote-store";
import { getAgentTradeReceiptStore } from "@/lib/agent-trade-receipt-store";
import { getUAClient } from "@/lib/ua";

/** Settle terminal provider finality without any signing or submission capability. */
export async function settleReconciledExecution(
  record: ExecutionFinalityRecord,
  ownerAddress: string,
): Promise<ExecutionFinalityRecord> {
  if (
    record.outcome !== "finalized" &&
    record.outcome !== "failed" &&
    record.outcome !== "partial" &&
    record.outcome !== "needs_attention"
  ) {
    return record;
  }
  const agentStore = getPublicAgentProvisioningStore();
  const agent = await agentStore.findBySignerAddress(ownerAddress);
  if (!agent || agent.agentId !== record.agentId) return record;

  const permitStore = getAgentPermitStore();
  const spendLedger = getAgentSpendLedger();
  const executionFinalityStore = getExecutionFinalityStore();
  await settleExecutionFinality({
    agent,
    record,
    permitStore,
    idempotencyStore: getAgentExecuteIdempotencyStore(),
    receipts: getAgentReceiptPersist(),
    quoteStore: getAgentQuoteStore(),
    tradeReceipts: getAgentTradeReceiptStore(),
    backStore: getAgentBackRecordStore(),
    startBackWorkflow: createBackWorkflowStarter(),
    attributeBack: createConvictionBackAttributionApplier(),
    executionFinalityStore,
    spendLedger,
    onSpend: async (dollarsIn) => {
      const beforeSpend = await agentStore.findBySignerAddress(ownerAddress);
      await commitAgentSpend({
        store: agentStore,
        auditStore: getAgentAuditStore(),
        permitStore,
        spendLedger,
        agentId: agent.agentId,
        dollarsIn,
        previousStatus: beforeSpend?.status ?? agent.status,
      });
    },
  });
  return (await executionFinalityStore.get(record.executionId)) ?? record;
}

export function createExecutionWorkflowStarter(options?: {
  local?: boolean;
}): ExecutionWorkflowStarter {
  const forceLocal =
    options?.local === true ||
    process.env.NODE_ENV === "test" ||
    process.env.CONVICTION_WORKFLOW_WORLD === "local";

  return {
    async start(executionId, ownerAddress) {
      if (forceLocal) {
        const runId = `local_execution_${executionId}`;
        setTimeout(() => {
          void runExecutionReconciliationRetries({
            executionId,
            reconcile: createExecutionReconciler({
              store: getExecutionFinalityStore(),
              ua: getUAClient(ownerAddress),
            }),
          })
            .then((record) => settleReconciledExecution(record, ownerAddress))
            .catch(() => undefined);
        }, 0);
        return { runId };
      }

      const { start } = await import("workflow/api");
      const { executionFinalityWorkflow } = await import(
        "@/workflows/execution-finality"
      );
      const run = await start(executionFinalityWorkflow, [
        executionId,
        ownerAddress,
      ]);
      return { runId: run.runId };
    },
  };
}
