/**
 * Post-commit operator event outbox (issue #61 review).
 * Domain transitions emit one typed event; this module fans out to durable
 * audit + idempotent notifications. Execution paths never schedule either
 * store directly.
 */

import {
  buildAuditEvent,
  getAgentAuditStore,
  type AgentAuditEventType,
} from "@/lib/agent-audit";
import {
  getAgentNotificationStore,
  type NotificationKind,
  type Severity,
} from "@/lib/agent-notifications";

export type OperatorEvent =
  | {
      type: "trade_executed";
      agentId: string;
      ownerUserId: string;
      receiptId: string;
      transactionId: string;
      summary: string;
    }
  | {
      type: "back_executed";
      agentId: string;
      ownerUserId: string;
      receiptId: string;
      backRecordId: string;
      reconciliationState: "complete" | "pending_sync" | "needs_attention";
    }
  | {
      type: "reconciliation_escalated";
      agentId: string;
      ownerUserId: string;
      resource: "back" | "retirement";
      resourceId: string;
      receiptId?: string;
      backRecordId?: string;
      retirementId?: string;
      error: string | null;
    }
  | {
      type: "execution_finality_attention";
      agentId: string;
      ownerUserId: string;
      executionId: string;
      transactionId: string | null;
      outcome: "partial" | "failed" | "needs_attention";
      affectedLeg: {
        legId: string;
        kind: string;
        chainName: string;
        status: string;
        lastProviderStatus: string | null;
        confirmedHash: string | null;
        error: string | null;
      } | null;
      lastProviderStatus: string | null;
      workflowRunId: string | null;
      correlationId: string | null;
      recoveryPath: string;
    }
  | {
      type: "retirement_finality_attention";
      agentId: string;
      ownerUserId: string;
      retirementId: string;
      transactionId: string | null;
      affectedLeg: {
        legId: string;
        kind: string;
        status: string;
        lastProviderStatus: string | null;
        confirmedHash: string | null;
        error: string | null;
      } | null;
      workflowRunId: string | null;
      recoveryPath: string;
    };

type Projection = {
  auditType: AgentAuditEventType;
  auditDetails: Record<string, unknown>;
  notification: {
    kind: NotificationKind;
    severity: Severity;
    title: string;
    body: string;
    dedupeKey: string;
    receiptId?: string;
    backRecordId?: string;
    retirementId?: string;
    correlationId?: string;
  };
};

function operatorAlertText(
  value: string | null | undefined,
  fallback = "unknown",
): string {
  if (!value?.trim()) return fallback;
  const redacted = value
    .trim()
    .replace(
      /\b(authorization|bearer|credential|private[_-]?key|signature)\b\s*[:=]?\s*\S+/gi,
      "$1 [redacted]",
    );
  return redacted.length > 300 ? `${redacted.slice(0, 299)}…` : redacted;
}

function project(event: OperatorEvent): Projection {
  switch (event.type) {
    case "trade_executed":
      return {
        auditType: "execute_result",
        auditDetails: {
          action: "trade",
          receiptId: event.receiptId,
          transactionId: event.transactionId,
        },
        notification: {
          kind: "trade_success",
          severity: "info",
          title: "Trade executed",
          body: event.summary,
          dedupeKey: event.receiptId,
          receiptId: event.receiptId,
          correlationId: event.transactionId,
        },
      };
    case "back_executed":
      return {
        auditType: "back",
        auditDetails: {
          backRecordId: event.backRecordId,
          receiptId: event.receiptId,
          reconciliationState: event.reconciliationState,
        },
        notification: {
          kind: "back_success",
          severity:
            event.reconciliationState === "complete" ? "info" : "warning",
          title: "Back executed",
          body:
            event.reconciliationState === "complete"
              ? "Your conviction back was executed and attributed."
              : "Your conviction back was executed; attribution is still syncing.",
          dedupeKey: event.backRecordId,
          receiptId: event.receiptId,
          backRecordId: event.backRecordId,
        },
      };
    case "reconciliation_escalated": {
      const label =
        event.resource === "back"
          ? "Back attribution"
          : "Retirement reconciliation";
      return {
        auditType: "reconciliation_needs_attention",
        auditDetails: {
          resource: event.resource,
          resourceId: event.resourceId,
          error: event.error,
          ...(event.backRecordId ? { backRecordId: event.backRecordId } : {}),
          ...(event.retirementId ? { retirementId: event.retirementId } : {}),
        },
        notification: {
          kind: "reconciliation_needs_attention",
          severity: "critical",
          title: `${label} needs attention`,
          body: event.error ?? `${label} could not be completed.`,
          dedupeKey: event.resourceId,
          ...(event.receiptId ? { receiptId: event.receiptId } : {}),
          ...(event.backRecordId ? { backRecordId: event.backRecordId } : {}),
          ...(event.retirementId ? { retirementId: event.retirementId } : {}),
        },
      };
    }
    case "execution_finality_attention": {
      const leg = event.affectedLeg;
      const evidence = leg
        ? `${operatorAlertText(leg.kind)} leg ${operatorAlertText(leg.legId)} on ${operatorAlertText(leg.chainName)} is ${operatorAlertText(leg.status)}; provider ${operatorAlertText(leg.lastProviderStatus ?? event.lastProviderStatus)}${leg.confirmedHash ? `; confirmed ${operatorAlertText(leg.confirmedHash)}` : ""}${leg.error ? `; error ${operatorAlertText(leg.error)}` : ""}.`
        : `Provider state is ${operatorAlertText(event.lastProviderStatus)}.`;
      const workflow = event.workflowRunId
        ? ` Workflow ${operatorAlertText(event.workflowRunId)}.`
        : event.correlationId
          ? ` Correlation ${operatorAlertText(event.correlationId)}.`
          : "";
      return {
        auditType: "reconciliation_needs_attention",
        auditDetails: {
          resource: "execution",
          executionId: event.executionId,
          transactionId: event.transactionId,
          outcome: event.outcome,
          affectedLeg: event.affectedLeg,
          lastProviderStatus: event.lastProviderStatus,
          workflowRunId: event.workflowRunId,
          correlationId: event.correlationId,
          recoveryPath: event.recoveryPath,
        },
        notification: {
          kind: "reconciliation_needs_attention",
          severity: event.outcome === "partial" ? "warning" : "critical",
          title:
            event.outcome === "partial"
              ? "Execution partially confirmed"
              : "Execution needs attention",
          body: `Transaction ${operatorAlertText(event.transactionId ?? event.executionId)}: ${evidence}${workflow} Recovery: ${operatorAlertText(event.recoveryPath)}`,
          dedupeKey: `execution:${event.executionId}`,
          ...(event.correlationId
            ? { correlationId: event.correlationId }
            : {}),
        },
      };
    }
    case "retirement_finality_attention": {
      const leg = event.affectedLeg;
      const evidence = leg
        ? `${operatorAlertText(leg.kind)} leg ${operatorAlertText(leg.legId)} is ${operatorAlertText(leg.status)}; provider ${operatorAlertText(leg.lastProviderStatus)}${leg.confirmedHash ? `; confirmed ${operatorAlertText(leg.confirmedHash)}` : ""}${leg.error ? `; error ${operatorAlertText(leg.error)}` : ""}.`
        : "No submitted retirement leg has confirmed finality.";
      return {
        auditType: "reconciliation_needs_attention",
        auditDetails: {
          resource: "retirement",
          retirementId: event.retirementId,
          transactionId: event.transactionId,
          affectedLeg: event.affectedLeg,
          workflowRunId: event.workflowRunId,
          recoveryPath: event.recoveryPath,
        },
        notification: {
          kind: "reconciliation_needs_attention",
          severity: "critical",
          title: "Retirement recovery needs attention",
          body: `Retirement ${operatorAlertText(event.retirementId)}: ${evidence}${event.workflowRunId ? ` Workflow ${operatorAlertText(event.workflowRunId)}.` : ""} Recovery: ${operatorAlertText(event.recoveryPath)}`,
          dedupeKey: `retirement:${event.retirementId}`,
          retirementId: event.retirementId,
          ...(event.workflowRunId
            ? { correlationId: event.workflowRunId }
            : {}),
        },
      };
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Fire-and-forget projection to audit + notifications.
 * Never throws to the caller and never blocks transaction results.
 */
export function emitOperatorEvent(event: OperatorEvent): void {
  const projected = project(event);
  void getAgentAuditStore()
    .append(
      buildAuditEvent({
        agentId: event.agentId,
        ownerUserId: event.ownerUserId,
        type: projected.auditType,
        actor: "system",
        details: projected.auditDetails,
      }),
    )
    .catch(() => undefined);

  void getAgentNotificationStore()
    .createIdempotent({
      agentId: event.agentId,
      ownerUserId: event.ownerUserId,
      ...projected.notification,
    })
    .catch(() => undefined);
}
