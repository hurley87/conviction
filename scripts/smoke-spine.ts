#!/usr/bin/env npx tsx
/**
 * Manually-gated real-funds spine smoke test (ADR 0014).
 * Never run in CI. Requires Particle + Privy env and a funded mainnet account.
 *
 * Usage:
 *   SMOKE_OWNER_ADDRESS=0x... npx tsx scripts/smoke-spine.ts
 *
 * Optional:
 *   SMOKE_SIZE_USD=5  (default 5 — keep tiny)
 */

// Standalone tsx scripts don't get Next.js's automatic .env.local loading,
// so pull it in explicitly before reading any NEXT_PUBLIC_* vars.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to whatever is already in the environment.
}

const REQUIRED_ENV = [
  "NEXT_PUBLIC_PARTICLE_PROJECT_ID",
  "NEXT_PUBLIC_PARTICLE_CLIENT_KEY",
  "NEXT_PUBLIC_PARTICLE_APP_ID",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Aborting smoke test.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  for (const key of REQUIRED_ENV) requireEnv(key);

  const ownerAddress = process.env.SMOKE_OWNER_ADDRESS;
  if (!ownerAddress) {
    console.error(
      "Set SMOKE_OWNER_ADDRESS to a funded EOA. This test moves real mainnet funds.",
    );
    process.exit(1);
  }

  const sizeUsd = parseFloat(process.env.SMOKE_SIZE_USD ?? "5");
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    console.error("SMOKE_SIZE_USD must be a positive number.");
    process.exit(1);
  }

  console.log("⚠️  Real-funds smoke test — NOT for CI (ADR 0014)");
  console.log(`Owner: ${ownerAddress}, size: $${sizeUsd}`);
  console.log(
    "This script validates env + quote shape only. Full signing requires the in-app concierge with Privy.",
  );

  const { createParticleUAClient } = await import("../src/lib/ua/particle");
  const ua = createParticleUAClient({
    ownerAddress,
    projectId: requireEnv("NEXT_PUBLIC_PARTICLE_PROJECT_ID"),
    projectClientKey: requireEnv("NEXT_PUBLIC_PARTICLE_CLIENT_KEY"),
    projectAppUuid: requireEnv("NEXT_PUBLIC_PARTICLE_APP_ID"),
  });

  const balance = await ua.getUniversalBalance();
  console.log(`Unified balance: $${balance.totalUsd.toFixed(2)}`);
  if (balance.totalUsd < sizeUsd) {
    console.error("Insufficient balance for smoke size.");
    process.exit(1);
  }

  const quote = await ua.quoteTrade({
    intent: { toAsset: "cash", destChain: "Arbitrum" },
    sizeUsd,
  });

  console.log("Quote:");
  console.log(`  In:  $${quote.dollarsIn.toFixed(2)}`);
  console.log(`  Out: $${quote.dollarsOut.toFixed(2)}`);
  console.log(`  Fee: $${quote.feeUsd.toFixed(2)}`);
  console.log(`  Floor: $${quote.floorUsd.toFixed(2)}`);
  console.log(`  Source: ${quote.sourceChain} → ${quote.destChain}`);

  if (quote.sourceChain === quote.destChain) {
    console.warn("Warning: source and dest chain are the same — not cross-chain.");
  }

  console.log(
    "\nTo complete the move, confirm in the app concierge (requires Privy 7702 signing).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
