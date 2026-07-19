// Durable read-only Particle reconciliation. This workflow has no signing or
// submission dependency and can only advance an existing execution record.

import { sleep } from "workflow";

import { createExecutionReconciler } from "@/lib/agent-execution-reconciliation";
import type { ExecutionFinalityRecord } from "@/lib/agent-execution-finality";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { settleReconciledExecution } from "@/lib/agent-execution-workflow";
import { getUAClient } from "@/lib/ua";

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

async function reconcileExecutionStep(
  executionId: string,
  ownerAddress: string,
): Promise<ExecutionFinalityRecord> {
  "use step";
  const record = await createExecutionReconciler({
    store: getExecutionFinalityStore(),
    ua: getUAClient(ownerAddress),
  }).reconcile(executionId);
  return settleReconciledExecution(record, ownerAddress);
}

export async function executionFinalityWorkflow(
  executionId: string,
  ownerAddress: string,
): Promise<ExecutionFinalityRecord> {
  "use workflow";

  let latest: ExecutionFinalityRecord | null = null;
  for (const delay of RETRY_DELAYS_MS) {
    await sleep(delay);
    latest = await reconcileExecutionStep(executionId, ownerAddress);
    if (
      latest.outcome === "finalized" ||
      latest.outcome === "needs_attention"
    ) {
      return latest;
    }
  }
  return latest!;
}
