// Account status for MCP / agent APIs — policy fields plus UA balance & deposits.

import { buildAgentAccountStatus } from "@/lib/agent-lease";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import { getUAClient } from "@/lib/ua";
import type { DepositAddresses, UniversalBalance } from "@/lib/verbs/types";

export type AgentAccountStatus = ReturnType<typeof buildAgentAccountStatus> & {
  balance: UniversalBalance;
  depositAddresses: DepositAddresses;
};

/**
 * Build account status with unified balance and deposit addresses.
 * Falls back to empty balance / EOA deposit when UA lookup fails so reads stay available.
 */
export async function loadAgentAccountStatus(
  agent: OwnedAgent,
): Promise<AgentAccountStatus> {
  const base = buildAgentAccountStatus(agent);
  const emptyBalance: UniversalBalance = { totalUsd: 0, sources: [] };
  const fallbackDeposits: DepositAddresses = {
    evm: base.depositAddress,
    solana: null,
  };

  try {
    const ua = getUAClient(agent.address ?? undefined);
    const [balance, depositAddresses] = await Promise.all([
      ua.getUniversalBalance(),
      ua.getDepositAddresses(),
    ]);
    return {
      ...base,
      balance,
      depositAddresses,
      depositAddress: depositAddresses.evm || base.depositAddress,
    };
  } catch {
    return {
      ...base,
      balance: emptyBalance,
      depositAddresses: fallbackDeposits,
    };
  }
}
