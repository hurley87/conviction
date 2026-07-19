import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import { createExecutionReconciler } from "@/lib/agent-execution-reconciliation";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { settleReconciledExecution } from "@/lib/agent-execution-workflow";
import {
  executionStatusForOperator,
  retirementStatusForOperator,
} from "@/lib/agent-operator-finality";
import { getAgentQuoteStore } from "@/lib/agent-quote-store";
import { reconcileRetirementResiduals } from "@/lib/agent-retirement";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import { getUAClient } from "@/lib/ua";

type RetryBody = {
  agentId?: string;
  resourceType?: "execution" | "retirement";
  resourceId?: string;
};

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new AgentProvisioningError(
      "invalid_request",
      `${field} is required.`,
    );
  }
  return normalized;
}

/**
 * Operator-only retry. The reachable seams perform provider/balance reads and
 * idempotent settlement bookkeeping only; signing, quoting, spend reservation,
 * sendTransaction, and retirement submission remain unreachable.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const body = (await request.json().catch(() => null)) as RetryBody | null;
    const agentId = required(body?.agentId, "agentId");
    const resourceId = required(body?.resourceId, "resourceId");
    if (
      body?.resourceType !== "execution" &&
      body?.resourceType !== "retirement"
    ) {
      throw new AgentProvisioningError(
        "invalid_request",
        "resourceType must be execution or retirement.",
      );
    }

    const agent = await ctx.store.findNonRetiredByOwner(ctx.ownerUserId);
    if (!agent || agent.agentId !== agentId) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No agent matches that identity for this account.",
      );
    }
    if (!agent.address) {
      throw new AgentProvisioningError(
        "lifecycle_blocked",
        "The agent signer address is not ready for finality reconciliation.",
      );
    }

    if (body.resourceType === "execution") {
      const store = getExecutionFinalityStore();
      let record = await store.get(resourceId);
      if (!record || record.agentId !== agent.agentId) {
        throw new AgentProvisioningError(
          "agent_not_found",
          "No execution matches that identity for this account.",
        );
      }
      const canRead =
        record.outcome === "submitted" || record.outcome === "pending";
      const canSettle =
        (record.outcome === "finalized" &&
          (record.settlementStatus === "held" ||
            record.settlementStatus === "persisting")) ||
        (record.outcome === "failed" &&
          record.settlementStatus !== "released");
      if (!canRead && !canSettle) {
        throw new AgentProvisioningError(
          "lifecycle_blocked",
          "This execution requires manual recovery; read-only retry cannot sign or resubmit it.",
        );
      }
      if (canRead) {
        record = await createExecutionReconciler({
          store,
          ua: getUAClient(agent.address),
        }).reconcile(record.executionId);
      }
      record = await settleReconciledExecution(record, agent.address);
      return Response.json(
        {
          status: await executionStatusForOperator(
            record,
            getAgentQuoteStore(),
          ),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const retirementStore = getAgentRetirementStore();
    const retirement = await retirementStore.get(resourceId);
    if (
      !retirement ||
      retirement.agentId !== agent.agentId ||
      retirement.ownerUserId !== ctx.ownerUserId
    ) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No retirement matches that identity for this account.",
      );
    }
    if (retirement.reconciliationState === "complete") {
      throw new AgentProvisioningError(
        "lifecycle_blocked",
        "Retirement recovery is already complete.",
      );
    }
    const updated = await reconcileRetirementResiduals({
      store: ctx.store,
      retirementStore,
      auditStore: ctx.auditStore,
      retirementId: retirement.retirementId,
      ua: getUAClient(agent.address),
    });
    return Response.json(
      { status: retirementStatusForOperator(updated) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
