import "server-only";

import {
  reconcileBackAttribution,
  type BackAttributionApplier,
  type BackWorkflowStarter,
} from "@/lib/agent-back";
import { getAgentBackRecordStore } from "@/lib/agent-back-store";
import { addBacker } from "@/lib/convictions";

/** Apply public attribution with agent authorship disclosure (ADR 0018 / 0026). */
export function createConvictionBackAttributionApplier(): BackAttributionApplier {
  return {
    async apply(input) {
      try {
        const backedBy = await addBacker(
          input.entryId,
          input.authorship.handle,
          input.authorship,
        );
        if (!backedBy) {
          return {
            ok: false,
            retryable: false,
            message: `Conviction ${input.entryId} was not found for attribution.`,
          };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          message:
            error instanceof Error
              ? error.message
              : "Attribution temporarily unavailable.",
        };
      }
    },
  };
}

/**
 * Start durable back-attribution reconciliation.
 * Uses Vercel Workflow when available; falls back to an in-process runner for
 * local/test worlds (ADR 0029).
 */
export function createBackWorkflowStarter(options?: {
  /** Force the deterministic local runner (tests / CI). */
  local?: boolean;
  attribute?: BackAttributionApplier;
}): BackWorkflowStarter {
  const attribute =
    options?.attribute ?? createConvictionBackAttributionApplier();
  const forceLocal =
    options?.local === true ||
    process.env.NODE_ENV === "test" ||
    process.env.CONVICTION_WORKFLOW_WORLD === "local";

  return {
    async start(backRecordId: string) {
      if (forceLocal) {
        const runId = `local_${backRecordId}`;
        // Fire-and-forget local reconciliation — domain record is already durable.
        void reconcileBackAttribution({
          backRecordId,
          backStore: getAgentBackRecordStore(),
          attribute,
        }).catch(() => undefined);
        return { runId };
      }

      try {
        const { start } = await import("workflow/api");
        const { backAttributionWorkflow } = await import(
          "@/workflows/back-attribution"
        );
        const run = await start(backAttributionWorkflow, [backRecordId]);
        const runId =
          typeof run === "object" &&
          run !== null &&
          "runId" in run &&
          typeof (run as { runId: unknown }).runId === "string"
            ? (run as { runId: string }).runId
            : `workflow_${backRecordId}`;
        return { runId };
      } catch {
        // Fail soft into local reconciliation so onchain success still returns.
        const runId = `local_fallback_${backRecordId}`;
        void reconcileBackAttribution({
          backRecordId,
          backStore: getAgentBackRecordStore(),
          attribute,
        }).catch(() => undefined);
        return { runId };
      }
    },
  };
}
