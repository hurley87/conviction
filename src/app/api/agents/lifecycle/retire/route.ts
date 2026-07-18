import { getAgentAuditStore } from "@/lib/agent-audit";
import { privatePausedReason } from "@/lib/agent-policy";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import {
  getAgentPermitStore,
  getAgentSpendLedger,
} from "@/lib/agent-permit-store";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import {
  canUseMockRetirementRecovery,
  executeRetirementRecovery,
  startRetirementBySigner,
  startRetirementReconciliationWorkflow,
} from "@/lib/agent-retirement";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { createRetirementWorkflowStarter } from "@/lib/agent-retirement-workflow";
import { getUAClient, hasParticleEnv } from "@/lib/ua";
import { mockTradeSigners } from "@/lib/ua/mock";

/**
 * POST /api/agents/lifecycle/retire
 * Agent-signer authenticated retirement used by `conviction-mcp retire`.
 * Starts retiring (blocks writes) then runs canonical-cash recovery only on the
 * explicit mock/local path. Live Particle recovery continues via prepare →
 * sign → submit on /lifecycle/retirement/recover.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/lifecycle/retire",
      store,
      nonceStore: getAgentNonceStore(),
    });

    const body = JSON.parse(rawBody || "{}") as {
      idempotencyKey?: string;
    };

    const started = await startRetirementBySigner({
      store,
      retirementStore: getAgentRetirementStore(),
      auditStore: getAgentAuditStore(),
      permitStore: getAgentPermitStore(),
      spendLedger: getAgentSpendLedger(),
      agent: verified.agent,
      ...(typeof body.idempotencyKey === "string"
        ? { idempotencyKey: body.idempotencyKey }
        : {}),
    });

    let agent = started.agent;
    let retirement = started.retirement;

    // Fail closed in production without Particle — never mock-complete retirement.
    if (
      !hasParticleEnv() &&
      canUseMockRetirementRecovery() &&
      agent.status === "retiring" &&
      retirement.reconciliationState !== "complete"
    ) {
      const recovered = await executeRetirementRecovery({
        store,
        retirementStore: getAgentRetirementStore(),
        auditStore: getAgentAuditStore(),
        agent,
        retirementId: retirement.retirementId,
        ua: getUAClient(agent.address ?? undefined),
        signers: mockTradeSigners,
      });
      agent = recovered.agent;
      retirement = recovered.retirement;
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
        signerNote: hasParticleEnv()
          ? "Live Particle recovery requires CLI-held root-hash signatures via prepare → sign → submit. Conviction cannot reconstruct or replace the local signer."
          : "Recovery uses the original local signer only. Conviction cannot reconstruct or replace it.",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentRequestAuthError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: agentAuthErrorStatus(error.code) },
      );
    }
    if (error instanceof AgentProvisioningError) {
      const status =
        error.code === "agent_not_found"
          ? 404
          : error.code === "lifecycle_blocked"
            ? 409
            : error.code === "setup_not_ready"
              ? 503
              : 422;
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Request body must be JSON.",
          },
        },
        { status: 422 },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Agent retirement is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
