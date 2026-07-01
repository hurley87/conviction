// Reports whether an account is already EIP-7702 upgraded, by reading its
// on-chain code on the settlement chain (ADR 0005). Keeps the RPC server-side.

import { ethers } from "ethers";
import { isDelegated } from "@/lib/verbs/wallet";

const ARBITRUM_RPC =
  process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ error: "valid address required" }, { status: 400 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const code = await provider.getCode(address);
    return Response.json({ upgraded: isDelegated(code) });
  } catch {
    // Can't determine — report not-upgraded so the UI shows the (harmless)
    // upgrade affordance rather than falsely claiming "ready".
    return Response.json({ upgraded: false });
  }
}
