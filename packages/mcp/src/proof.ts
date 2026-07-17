import { getAddress } from "ethers";

export const PROVISIONING_PROOF_PREFIX = "Conviction MCP provisioning";
export const BACKUP_VERIFIED_PROOF_PREFIX = "Conviction MCP backup verified";

export function buildProvisioningProofMessage(
  codeHash: string,
  signerAddress: string,
): string {
  return [
    PROVISIONING_PROOF_PREFIX,
    "v1",
    `code:${codeHash}`,
    `signer:${getAddress(signerAddress)}`,
  ].join("\n");
}

export function buildBackupVerifiedMessage(
  agentId: string,
  signerAddress: string,
): string {
  return [
    BACKUP_VERIFIED_PROOF_PREFIX,
    "v1",
    `agent:${agentId}`,
    `signer:${getAddress(signerAddress)}`,
  ].join("\n");
}
