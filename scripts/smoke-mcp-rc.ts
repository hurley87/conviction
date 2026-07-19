#!/usr/bin/env npx tsx
/**
 * Manually-gated full MCP release-candidate smoke (issue #61 / PRD §16 Tier 3).
 * Never run in CI. Moves real funds when Particle is configured.
 *
 * Journey: inspect → quote → execute → publish → back → receipt → disable → enable
 * Optional: retire (SMOKE_INCLUDE_RETIRE=1) — permanently closes the agent.
 *
 * Usage:
 *   CONVICTION_MCP_SMOKE_RC=1 \
 *   CONVICTION_API_BASE=http://127.0.0.1:3000 \
 *   CONVICTION_KEYSTORE_PASSWORD=... \
 *   CONVICTION_PROFILE=hurls-agent \
 *   npx tsx scripts/smoke-mcp-rc.ts
 *
 * Optional:
 *   SMOKE_SIZE_USD=1
 *   SMOKE_INCLUDE_RETIRE=1
 */

import { randomUUID } from "node:crypto";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to ambient environment.
}

async function main() {
  if (process.env.CONVICTION_MCP_SMOKE_RC !== "1") {
    console.error(
      "Refusing to run. Set CONVICTION_MCP_SMOKE_RC=1 to acknowledge real funds.",
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
      console.error(`Missing ${key}. Aborting RC smoke.`);
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
  const includeRetire = process.env.SMOKE_INCLUDE_RETIRE === "1";

  console.log("⚠️  MCP RC smoke — NOT for CI (issue #61 / ADR 0014)");
  console.log(
    `API: ${apiBase}, size: $${sizeUsd}, retire: ${includeRetire ? "yes" : "no"}`,
  );

  const { readAgentProfile } = await import("../packages/mcp/src/profile.js");
  const { loadWalletFromKeystore } = await import(
    "../packages/mcp/src/keystore.js"
  );
  const { createLocalTradeSigners } = await import(
    "../packages/mcp/src/local-trade-signers.js"
  );
  const {
    acquireAgentLease,
    disableAgentLifecycle,
    enableAgentLifecycle,
    fetchAgentStatus,
    fetchReceipt,
    publishConviction,
    releaseAgentLease,
    requestBackQuote,
    requestExecutionPermit,
    requestTradeQuote,
    retireAgentLifecycle,
    submitSignedExecution,
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

  const lease = await acquireAgentLease({
    apiBaseUrl: apiBase,
    wallet,
    replace: true,
  });
  console.log(`Lease acquired: ${lease.leaseId}`);

  async function signAndSubmit(input: {
    quoteId: string;
    idempotencyKey: string;
    expectedAction?: "trade" | "back";
  }) {
    const permitOrResult = await requestExecutionPermit({
      apiBaseUrl: apiBase,
      wallet,
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
      leaseId: lease.leaseId,
      ...(input.expectedAction
        ? { expectedAction: input.expectedAction }
        : {}),
    });

    if ("receiptId" in permitOrResult && permitOrResult.ok) {
      return permitOrResult;
    }
    if (!("permitId" in permitOrResult) || !permitOrResult.ok) {
      throw new Error(`Permit failed: ${JSON.stringify(permitOrResult)}`);
    }

    const raw = permitOrResult.rawTransaction as {
      rootHash?: string;
      userOps?: Parameters<typeof userOpsNeeding7702>[0];
    };
    if (!raw.rootHash) {
      throw new Error("Permit missing rootHash.");
    }

    const rootHashSignature = await signers.signRootHash(raw.rootHash);
    const authorizations = [];
    for (const pending of userOpsNeeding7702(raw.userOps)) {
      authorizations.push({
        userOpHash: pending.userOpHash,
        signature: await signers.sign7702(pending.auth),
      });
    }

    return submitSignedExecution({
      apiBaseUrl: apiBase,
      wallet,
      permitId: permitOrResult.permitId,
      idempotencyKey: input.idempotencyKey,
      leaseId: lease.leaseId,
      rootHashSignature,
      ...(authorizations.length > 0 ? { authorizations } : {}),
    });
  }

  try {
    // 1. Inspect
    const status = await fetchAgentStatus({ apiBaseUrl: apiBase, wallet });
    console.log(
      `Inspect: @${status.handle} ${status.status} balance≈$${status.balance.totalUsd}`,
    );

    // 2–3. Quote + execute (publication-intent so we can publish)
    const tradeQuote = await requestTradeQuote({
      apiBaseUrl: apiBase,
      wallet,
      input: {
        toAsset: "eth",
        sizeUsd,
        destChain: "Arbitrum",
        publicationIntent: true,
      },
    });
    console.log(`Quote trade ${tradeQuote.quoteId}: $${tradeQuote.dollarsIn}`);

    const tradeIdem = `rc-trade-${randomUUID()}`;
    const tradeResult = await signAndSubmit({
      quoteId: tradeQuote.quoteId,
      idempotencyKey: tradeIdem,
      expectedAction: "trade",
    });
    if (!tradeResult.ok) {
      throw new Error(`Trade execute failed: ${JSON.stringify(tradeResult)}`);
    }
    console.log(`Execute: receipt ${tradeResult.receiptId}`);

    // 4. Publish
    const published = await publishConviction({
      apiBaseUrl: apiBase,
      wallet,
      input: {
        receiptId: tradeResult.receiptId,
        thesis: "RC smoke: ETH remains the settlement rail for Conviction agents.",
        whyNow: "Release-candidate journey validation for MCP v1.",
        whatBreaksIt: "Sustained Particle or UA outage would invalidate the thesis.",
        leaseId: lease.leaseId,
      },
    });
    if (!published.ok) {
      throw new Error(`Publish failed: ${JSON.stringify(published)}`);
    }
    const entryId = published.entryId;
    console.log(`Publish: entry ${entryId}`);

    // 5. Back the just-published conviction (tiny size)
    const backQuote = await requestBackQuote({
      apiBaseUrl: apiBase,
      wallet,
      input: {
        entryId,
        dollarsIn: Math.min(sizeUsd, 1),
      },
    });
    console.log(`Quote back ${backQuote.quoteId}: $${backQuote.dollarsIn}`);

    const backIdem = `rc-back-${randomUUID()}`;
    const backResult = await signAndSubmit({
      quoteId: backQuote.quoteId,
      idempotencyKey: backIdem,
      expectedAction: "back",
    });
    if (!backResult.ok) {
      throw new Error(`Back execute failed: ${JSON.stringify(backResult)}`);
    }
    console.log(
      `Back: receipt ${backResult.receiptId}` +
        ("backRecordId" in backResult ? ` record ${backResult.backRecordId}` : ""),
    );

    // 6. Receipt retrieval
    const receipt = await fetchReceipt({
      apiBaseUrl: apiBase,
      wallet,
      receiptId: tradeResult.receiptId,
    });
    console.log(`Receipt: ${receipt.receiptId}`);

    // 7–8. Pause + resume (operator lifecycle — not MCP tools)
    await releaseAgentLease({
      apiBaseUrl: apiBase,
      wallet,
      leaseId: lease.leaseId,
    }).catch(() => undefined);

    const disabled = await disableAgentLifecycle({
      apiBaseUrl: apiBase,
      wallet,
    });
    console.log(`Disable: status=${disabled.agent.status}`);

    const enabled = await enableAgentLifecycle({
      apiBaseUrl: apiBase,
      wallet,
    });
    console.log(`Enable: status=${enabled.agent.status}`);

    if (includeRetire) {
      const retired = await retireAgentLifecycle({
        apiBaseUrl: apiBase,
        wallet,
      });
      console.log(`Retire started: status=${retired.agent.status}`);
      console.log(
        "Complete recovery with: conviction-mcp retire --profile <name> (live Particle path).",
      );
    } else {
      console.log("Retire skipped (set SMOKE_INCLUDE_RETIRE=1 to include).");
    }

    console.log("✅ MCP RC smoke journey completed");
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
