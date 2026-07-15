#!/usr/bin/env npx tsx
/**
 * Thin CLI over src/lib/gate — token address in, structured gate report out.
 * Live routability uses Particle warm-up (issue #23). Unit tests mock the
 * HTTP + warm-up seams (ADR 0014); this script is for the desk morning workflow.
 *
 * Usage:
 *   npx tsx scripts/gate-check.ts --address 0x... --chain base
 *   npx tsx scripts/gate-check.ts 0x... arbitrum --json
 *
 * Env (for UA routability):
 *   NEXT_PUBLIC_PARTICLE_PROJECT_ID
 *   NEXT_PUBLIC_PARTICLE_CLIENT_KEY
 *   NEXT_PUBLIC_PARTICLE_APP_ID
 *   GATE_OWNER_ADDRESS  (any EOA — warm-up does not move funds)
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to whatever is already in the environment.
}

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/gate-check.ts --address <0x...> --chain <base|ethereum|arbitrum> [--json]
  npx tsx scripts/gate-check.ts <address> <chain> [--json]`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  address: string;
  chain: string;
  json: boolean;
} {
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");

  let address: string | undefined;
  let chain: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--address") {
      address = args[++i];
    } else if (arg === "--chain") {
      chain = args[++i];
    } else if (arg?.startsWith("-")) {
      usage();
    } else if (!address) {
      address = arg;
    } else if (!chain) {
      chain = arg;
    } else {
      usage();
    }
  }

  if (!address || !chain) usage();
  return { address, chain, json };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Required for UA routability warm-up.`);
    process.exit(1);
  }
  return value;
}

async function createParticleRouterCheck(): Promise<
  (token: { chainId: number; address: string }) => Promise<boolean>
> {
  const ownerAddress =
    process.env.GATE_OWNER_ADDRESS ??
    process.env.SMOKE_OWNER_ADDRESS ??
    "0x0000000000000000000000000000000000000001";

  const { UniversalAccount, UNIVERSAL_ACCOUNT_VERSION_V2 } = await import(
    "@particle-network/universal-account-sdk"
  );

  const ua = new UniversalAccount({
    projectId: requireEnv("NEXT_PUBLIC_PARTICLE_PROJECT_ID"),
    projectClientKey: requireEnv("NEXT_PUBLIC_PARTICLE_CLIENT_KEY"),
    projectAppUuid: requireEnv("NEXT_PUBLIC_PARTICLE_APP_ID"),
    smartAccountOptions: {
      name: "UNIVERSAL",
      version: UNIVERSAL_ACCOUNT_VERSION_V2,
      ownerAddress,
      useEIP7702: true,
    },
  }) as {
    warmUpToken: (token: {
      chainId: number;
      address: string;
    }) => Promise<{ router?: unknown | null } | null>;
    getTokenPair: (token: {
      chainId: number;
      address: string;
    }) => Promise<{ pair?: { address: string; factory: string } } | null>;
  };

  const { routerCheckFromWarmUp } = await import("../src/lib/gate");
  return routerCheckFromWarmUp(ua);
}

async function main() {
  const { address, chain, json } = parseArgs(process.argv.slice(2));

  const { runGateCheck, formatGateReport, resolveGateChain } = await import(
    "../src/lib/gate"
  );

  const chainInfo = resolveGateChain(chain);
  console.error(
    `Gate-check ${address} on ${chainInfo.name} (${chainInfo.chainId})…`,
  );

  const checkRouter = await createParticleRouterCheck();
  const report = await runGateCheck(address, chain, { checkRouter });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatGateReport(report));
  }

  const failed = report.some((c) => !c.passed);
  process.exit(failed ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
