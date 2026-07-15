// Diligence gate — token address in, structured GateCheck[] out (issue #23).
// Seed of Build 2's gate module (ADR 0016). External calls are injectable so
// CI stays offline (ADR 0014).

import type { GateCheck } from "@/lib/verbs/types";
import { resolveGateChain, type GateChainInfo } from "@/lib/gate/chains";
import { checkLiquidityDepth } from "@/lib/gate/liquidity";
import { checkContractAndHolders } from "@/lib/gate/contract";
import { checkUaRoutability } from "@/lib/gate/routability";
import type { WarmUpToken } from "@/lib/ua/warm-up";

export type { GateChainInfo };
export { resolveGateChain } from "@/lib/gate/chains";
export { DEFAULT_MIN_LIQUIDITY_USD } from "@/lib/gate/liquidity";
export {
  DEFAULT_MAX_TOP_HOLDER_FRACTION,
  DEFAULT_TOP_HOLDER_COUNT,
} from "@/lib/gate/contract";
export { routerCheckFromWarmUp } from "@/lib/gate/routability";

export type RunGateCheckOptions = {
  fetch?: typeof fetch;
  /** Injected routability seam. Required — live CLI wires Particle warm-up. */
  checkRouter: (token: WarmUpToken) => Promise<boolean>;
  minLiquidityUsd?: number;
  maxTopHolderFraction?: number;
  topHolderCount?: number;
};

/**
 * Run the three gate checks for a token and return the card-ready report
 * (`GateCheck[]` — pass/fail + evidence link per check).
 */
export async function runGateCheck(
  address: string,
  chain: string | number,
  options: RunGateCheckOptions,
): Promise<GateCheck[]> {
  const normalized = normalizeAddress(address);
  const chainInfo = resolveGateChain(chain);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const [liquidity, contract, routability] = await Promise.all([
    checkLiquidityDepth(normalized, chainInfo, {
      fetch: fetchImpl,
      minLiquidityUsd: options.minLiquidityUsd,
    }),
    checkContractAndHolders(normalized, chainInfo, {
      fetch: fetchImpl,
      maxTopHolderFraction: options.maxTopHolderFraction,
      topHolderCount: options.topHolderCount,
    }),
    checkUaRoutability(normalized, chainInfo, {
      checkRouter: options.checkRouter,
    }),
  ]);

  return [liquidity, contract, routability];
}

/** First failing check's plain-language name, for gate-kill cards. */
export function failedCheckName(report: GateCheck[]): string | undefined {
  return report.find((c) => !c.passed)?.name;
}

export function formatGateReport(report: GateCheck[]): string {
  const lines = report.map((c) => {
    const mark = c.passed ? "PASS" : "FAIL";
    const evidence = c.evidenceUrl ? `  ${c.evidenceUrl}` : "";
    return `[${mark}] ${c.name}${evidence}`;
  });
  const failed = failedCheckName(report);
  if (failed) {
    lines.push("");
    lines.push(`Gate kill: ${failed}`);
  } else {
    lines.push("");
    lines.push("All checks passed.");
  }
  return lines.join("\n");
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error(
      `Invalid token address "${address}". Expected a 0x-prefixed 40-hex EVM address.`,
    );
  }
  return trimmed;
}
