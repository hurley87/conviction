// Durable back-attribution reconciliation (ADR 0028 / 0029).
// Workflow steps never sign, issue permits, or move funds.

import {
  reconcileBackAttribution,
  type AgentBackRecord,
} from "@/lib/agent-back";
import { createConvictionBackAttributionApplier } from "@/lib/agent-back-attribution";
import { getAgentBackRecordStore } from "@/lib/agent-back-store";

async function attributeBackStep(backRecordId: string): Promise<AgentBackRecord> {
  "use step";
  return reconcileBackAttribution({
    backRecordId,
    backStore: getAgentBackRecordStore(),
    attribute: createConvictionBackAttributionApplier(),
  });
}

/**
 * Idempotent workflow: retry attribution only. Onchain execution is already
 * committed on the durable back record before this starts.
 */
export async function backAttributionWorkflow(
  backRecordId: string,
): Promise<AgentBackRecord> {
  "use workflow";
  return attributeBackStep(backRecordId);
}
