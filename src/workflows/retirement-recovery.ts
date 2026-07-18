// Durable retirement residual reconciliation (ADR 0029 / 0035).
// Workflow steps never sign, issue permits, or move funds.

import { sleep } from "workflow";

import {
  reconcileRetirementResiduals,
  type AgentRetirementRecord,
} from "@/lib/agent-retirement";
import { getAgentAuditStore } from "@/lib/agent-audit";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { getUAClient } from "@/lib/ua";

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

async function reconcileRetirementStep(
  retirementId: string,
): Promise<AgentRetirementRecord> {
  "use step";
  const retirement = await getAgentRetirementStore().get(retirementId);
  const ownerAddress = retirement
    ? (
        await getPublicAgentProvisioningStore().findNonRetiredByOwner(
          retirement.ownerUserId,
        )
      )?.address
    : null;

  return reconcileRetirementResiduals({
    store: getPublicAgentProvisioningStore(),
    retirementStore: getAgentRetirementStore(),
    auditStore: getAgentAuditStore(),
    retirementId,
    ua: getUAClient(ownerAddress ?? undefined),
  });
}

/**
 * Idempotent workflow: re-assess residuals after recovery legs are committed.
 * Value-moving retries remain operator/signer-authenticated outside the workflow.
 */
export async function retirementRecoveryWorkflow(
  retirementId: string,
): Promise<AgentRetirementRecord> {
  "use workflow";

  let latest = await reconcileRetirementStep(retirementId);

  for (
    let i = 0;
    i < RETRY_DELAYS_MS.length &&
    latest.reconciliationState === "pending_sync";
    i += 1
  ) {
    await sleep(RETRY_DELAYS_MS[i]!);
    latest = await reconcileRetirementStep(retirementId);
  }

  return latest;
}
