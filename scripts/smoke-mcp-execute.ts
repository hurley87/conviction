#!/usr/bin/env npx tsx
/**
 * Manually-gated minimal-value MCP live execute smoke (issue #56 / ADR 0045).
 * Never run in CI. Requires a provisioned local profile, Particle env, funded
 * agent UA, and a running Conviction API.
 *
 * Usage:
 *   CONVICTION_MCP_SMOKE_EXECUTE=1 \
 *   CONVICTION_API_BASE=http://127.0.0.1:3000 \
 *   CONVICTION_KEYSTORE_PASSWORD=... \
 *   npx tsx scripts/smoke-mcp-execute.ts
 *
 * Optional:
 *   SMOKE_SIZE_USD=1  (default 1 — keep tiny)
 *   CONVICTION_PROFILE=default
 */

import { createHash, randomUUID } from "node:crypto";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to whatever is already in the environment.
}

async function main() {
  if (process.env.CONVICTION_MCP_SMOKE_EXECUTE !== "1") {
    console.error(
      "Refusing to run. Set CONVICTION_MCP_SMOKE_EXECUTE=1 to acknowledge real funds.",
    );
    process.exit(1);
  }

  for (const key of [
    "NEXT_PUBLIC_PARTICLE_PROJECT_ID",
    "NEXT_PUBLIC_PARTICLE_CLIENT_KEY",
    "NEXT_PUBLIC_PARTICLE_APP_ID",
    "CONVICTION_KEYSTORE_PASSWORD",
  ] as const) {
    if (!process.env[key]) {
      console.error(`Missing ${key}. Aborting smoke test.`);
      process.exit(1);
    }
  }

  const apiBase =
    process.env.CONVICTION_API_BASE?.replace(/\/$/, "") ??
    "http://127.0.0.1:3000";
  const sizeUsd = Number(process.env.SMOKE_SIZE_USD ?? "1");
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0 || sizeUsd > 5) {
    console.error("SMOKE_SIZE_USD must be a positive number ≤ 5.");
    process.exit(1);
  }

  console.log("⚠️  MCP live execute smoke — NOT for CI (ADR 0045 / issue #56)");
  console.log(`API: ${apiBase}, size: $${sizeUsd}`);

  const { readAgentProfile } = await import("../packages/mcp/src/profile.js");
  const { loadWalletFromKeystore } = await import(
    "../packages/mcp/src/keystore.js"
  );
  const { createLocalTradeSigners } = await import(
    "../packages/mcp/src/local-trade-signers.js"
  );
  const {
    acquireAgentLease,
    requestTradeQuote,
    requestExecutionPermit,
    submitSignedExecution,
    releaseAgentLease,
  } = await import("../packages/mcp/src/live-api-client.js");
  const { userOpsNeeding7702 } = await import(
    "../packages/mcp/src/raw-transaction.js"
  );
  const { profilePath, resolveConvictionPaths } = await import(
    "../packages/mcp/src/paths.js"
  );

  const paths = resolveConvictionPaths();
  const profileName = process.env.CONVICTION_PROFILE ?? "default";
  const profile = await readAgentProfile(profilePath(paths, profileName));
  const wallet = await loadWalletFromKeystore(
    profile.keystorePath,
    process.env.CONVICTION_KEYSTORE_PASSWORD!,
  );

  const signers = createLocalTradeSigners(wallet);
  const rootProbe =
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const rootSig = await signers.signRootHash(rootProbe);
  console.log(
    `Local signer ready: ${wallet.address} (rootHash probe sig ${rootSig.slice(0, 18)}…)`,
  );

  const lease = await acquireAgentLease({
    apiBaseUrl: apiBase,
    wallet,
    replace: true,
  });
  console.log(`Lease acquired: ${lease.leaseId}`);

  try {
    const quote = await requestTradeQuote({
      apiBaseUrl: apiBase,
      wallet,
      input: {
        toAsset: "eth",
        sizeUsd,
        destChain: "Arbitrum",
      },
    });
    console.log(
      `Quote ${quote.quoteId}: $${quote.dollarsIn} → $${quote.dollarsOut} (floor $${quote.floorUsd})`,
    );

    const idempotencyKey = `smoke-${randomUUID()}`;
    const permitOrResult = await requestExecutionPermit({
      apiBaseUrl: apiBase,
      wallet,
      quoteId: quote.quoteId,
      idempotencyKey,
      leaseId: lease.leaseId,
    });

    if ("receiptId" in permitOrResult && permitOrResult.ok) {
      console.log("Idempotent prior result:", permitOrResult.receiptId);
      return;
    }
    if (!("permitId" in permitOrResult) || !permitOrResult.ok) {
      console.error("Permit failed:", permitOrResult);
      process.exit(1);
    }

    const raw = permitOrResult.rawTransaction as {
      rootHash?: string;
      userOps?: Parameters<typeof userOpsNeeding7702>[0];
    };
    if (!raw.rootHash) {
      console.error("Permit missing rootHash.");
      process.exit(1);
    }

    const rootHashSignature = await signers.signRootHash(raw.rootHash);
    const authorizations = [];
    for (const pending of userOpsNeeding7702(raw.userOps)) {
      authorizations.push({
        userOpHash: pending.userOpHash,
        signature: await signers.sign7702(pending.auth),
      });
    }

    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          quoteId: permitOrResult.quoteId,
          quoteFingerprint: permitOrResult.quoteFingerprint,
          dollarsIn: permitOrResult.dollarsIn,
        }),
      )
      .digest("hex")
      .slice(0, 12);
    console.log(
      `Signing permit ${permitOrResult.permitId} (bind ${fingerprint}, auths=${authorizations.length})`,
    );

    const result = await submitSignedExecution({
      apiBaseUrl: apiBase,
      wallet,
      permitId: permitOrResult.permitId,
      idempotencyKey,
      leaseId: lease.leaseId,
      rootHashSignature,
      ...(authorizations.length > 0 ? { authorizations } : {}),
    });

    if (!result.ok) {
      console.error("Execute failed:", result);
      process.exit(1);
    }

    console.log("✅ Live MCP execute succeeded");
    console.log(`   receiptId: ${result.receiptId}`);
    console.log(`   transactionId: ${result.transactionId}`);
    console.log(`   summary: ${result.summary}`);
    console.log(
      "Record SDK/ethers/fixture versions before enabling release publication (ADR 0045).",
    );
  } finally {
    await releaseAgentLease({
      apiBaseUrl: apiBase,
      wallet,
      leaseId: lease.leaseId,
    }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
