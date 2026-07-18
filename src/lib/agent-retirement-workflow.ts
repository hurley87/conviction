import "server-only";

import {
  reconcileRetirementResiduals,
  type RetirementWorkflowStarter,
} from "@/lib/agent-retirement";
import { getAgentAuditStore } from "@/lib/agent-audit";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { getUAClient } from "@/lib/ua";

/**
 * Start durable residual reconciliation after retirement recovery legs are
 * committed. Uses Vercel Workflow when available; local runner for tests (ADR 0029).
 */
export function createRetirementWorkflowStarter(options?: {
  local?: boolean;
}): RetirementWorkflowStarter {
  const forceLocal =
    options?.local === true ||
    process.env.NODE_ENV === "test" ||
    process.env.CONVICTION_WORKFLOW_WORLD === "local";

  return {
    async start(retirementId: string) {
      if (forceLocal) {
        const runId = `local_retire_${retirementId}`;
        void reconcileRetirementResiduals({
          store: getPublicAgentProvisioningStore(),
          retirementStore: getAgentRetirementStore(),
          auditStore: getAgentAuditStore(),
          retirementId,
          ua: getUAClient(),
        }).catch(() => undefined);
        return { runId };
      }

      try {
        const { start } = await import("workflow/api");
        const { retirementRecoveryWorkflow } = await import(
          "@/workflows/retirement-recovery"
        );
        const run = await start(retirementRecoveryWorkflow, [retirementId]);
        const runId =
          typeof run === "object" &&
          run !== null &&
          "runId" in run &&
          typeof (run as { runId: unknown }).runId === "string"
            ? (run as { runId: string }).runId
            : `workflow_retire_${retirementId}`;
        return { runId };
      } catch (error) {
        void reconcileRetirementResiduals({
          store: getPublicAgentProvisioningStore(),
          retirementStore: getAgentRetirementStore(),
          auditStore: getAgentAuditStore(),
          retirementId,
          ua: getUAClient(),
        }).catch(() => undefined);
        throw error instanceof Error
          ? error
          : new Error("Could not start retirement recovery workflow.");
      }
    },
  };
}
