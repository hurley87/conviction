import { privatePausedReason } from "@/lib/agent-policy";
import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import {
  reconcileRetirementResiduals,
  startRetirement,
  startRetirementReconciliationWorkflow,
} from "@/lib/agent-retirement";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { createRetirementWorkflowStarter } from "@/lib/agent-retirement-workflow";
import { getUAClient } from "@/lib/ua";
import { getAgentAuditStore } from "@/lib/agent-audit";

/**
 * POST /api/agents/retire
 * Operator (Privy) starts retirement. Blocks MCP writes immediately.
 * Fund recovery still requires the original local signer via the CLI path.
 * Empty/dust inventories may complete without signing.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const body = (await request.json().catch(() => null)) as {
      agentId?: string;
      idempotencyKey?: string;
    } | null;
    const agentId =
      typeof body?.agentId === "string" ? body.agentId.trim() : "";
    if (!agentId) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "agentId is required.",
          },
        },
        { status: 422 },
      );
    }

    const started = await startRetirement({
      store: ctx.store,
      retirementStore: getAgentRetirementStore(),
      auditStore: ctx.auditStore,
      permitStore: ctx.permitStore,
      spendLedger: ctx.spendLedger,
      ownerUserId: ctx.ownerUserId,
      agentId,
      ...(typeof body?.idempotencyKey === "string"
        ? { idempotencyKey: body.idempotencyKey }
        : {}),
    });

    // Without the local signer, only empty/dust inventories can complete here.
    let agent = started.agent;
    let retirement = started.retirement;
    if (
      agent.status === "retiring" &&
      retirement.reconciliationState !== "complete"
    ) {
      try {
        retirement = await reconcileRetirementResiduals({
          store: ctx.store,
          retirementStore: getAgentRetirementStore(),
          auditStore: getAgentAuditStore(),
          retirementId: retirement.retirementId,
          ua: getUAClient(agent.address ?? undefined),
        });
        const refreshed = await ctx.store.findNonRetiredByOwner(
          ctx.ownerUserId,
        );
        // After completion the agent is retired and leaves the non-retired slot.
        if (!refreshed || refreshed.agentId !== agent.agentId) {
          agent = {
            ...agent,
            status: "retired",
            publicStatus: "retired",
            retiredAt: retirement.completedAt,
          };
        } else {
          agent = refreshed;
        }
      } catch {
        // Leave pending_sync / needs_attention for CLI recovery.
      }
    }

    if (retirement.reconciliationState !== "complete") {
      const withWorkflow = await startRetirementReconciliationWorkflow({
        retirementStore: getAgentRetirementStore(),
        retirementId: retirement.retirementId,
        workflow: createRetirementWorkflowStarter(),
      });
      if (withWorkflow) retirement = withWorkflow;
    }

    return Response.json(
      {
        agent,
        retirement,
        releasedPermitCount: started.releasedPermitCount,
        recoveryRequired:
          agent.status === "retiring" &&
          retirement.reconciliationState !== "complete",
        privatePausedReason: privatePausedReason(agent),
        signerNote:
          "Fund recovery requires the original local MCP signer. Conviction cannot reconstruct or replace it. Run: conviction-mcp retire --profile <name>",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
