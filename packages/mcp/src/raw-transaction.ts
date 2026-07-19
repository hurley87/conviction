// Minimal Particle raw-transaction helpers for local MCP signing (ADR 0045).
// Kept in-package so @getconviction/mcp does not import the Next.js app tree.

export type RawUserOpWithChain = {
  chainId: number;
  userOpHash?: string;
  userOp?: {
    eip7702Auth?: { chainId: number; nonce: number; address: string };
    eip7702Delegated?: boolean;
  };
  eip7702Auth?: { chainId: number; nonce: number; address: string };
  eip7702Delegated?: boolean;
};

/** Collect userOps needing a 7702 authorization signature. */
export function userOpsNeeding7702(
  userOps: RawUserOpWithChain[] | undefined,
): Array<{
  userOpHash: string;
  auth: { contractAddress: string; chainId: number; nonce: number };
}> {
  if (!userOps) return [];
  const pending: Array<{
    userOpHash: string;
    auth: { contractAddress: string; chainId: number; nonce: number };
  }> = [];

  for (const op of userOps) {
    const auth = op.eip7702Auth ?? op.userOp?.eip7702Auth;
    const delegated = op.eip7702Delegated ?? op.userOp?.eip7702Delegated;
    if (auth && !delegated && op.userOpHash) {
      pending.push({
        userOpHash: op.userOpHash,
        auth: {
          contractAddress: auth.address,
          chainId: auth.chainId,
          nonce: auth.nonce,
        },
      });
    }
  }
  return pending;
}
