import "server-only";

import {
  createExecutionReconciler,
  runExecutionReconciliationRetries,
  type ExecutionWorkflowStarter,
} from "@/lib/agent-execution-reconciliation";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { getUAClient } from "@/lib/ua";

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
          }).catch(() => undefined);
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
