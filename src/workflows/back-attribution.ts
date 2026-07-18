// Durable back-attribution reconciliation (ADR 0028 / 0029).
// Workflow steps never sign, issue permits, or move funds.

import { sleep } from "workflow";

import {
  MAX_BACK_ATTRIBUTION_ATTEMPTS,
  reconcileBackAttribution,
  type AgentBackRecord,
} from "@/lib/agent-back";
import { createConvictionBackAttributionApplier } from "@/lib/agent-back-attribution";
import { getAgentBackRecordStore } from "@/lib/agent-back-store";

/** Backoff between attribution attempts (durable sleep). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

async function attributeBackStep(backRecordId: string): Promise<AgentBackRecord> {
  "use step";
  return reconcileBackAttribution({
    backRecordId,
    backStore: getAgentBackRecordStore(),
    attribute: createConvictionBackAttributionApplier(),
    maxAttempts: MAX_BACK_ATTRIBUTION_ATTEMPTS,
  });
}

/**
 * Idempotent workflow: retry attribution only. Onchain execution is already
 * committed on the durable back record before this starts.
 * Escalates to needs_attention after MAX_BACK_ATTRIBUTION_ATTEMPTS failures.
 */
export async function backAttributionWorkflow(
  backRecordId: string,
): Promise<AgentBackRecord> {
  "use workflow";

  let latest = await attributeBackStep(backRecordId);

  for (
    let i = 0;
    i < RETRY_DELAYS_MS.length &&
    latest.reconciliationState === "pending_sync";
    i += 1
  ) {
    await sleep(RETRY_DELAYS_MS[i]!);
    latest = await attributeBackStep(backRecordId);
  }

  return latest;
}
