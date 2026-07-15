#!/usr/bin/env npx tsx
/**
 * Publish a full-anatomy desk card through the verb layer (issue #27 / ADR 0016).
 *
 * Prerequisites:
 *   1. Open the desk position onchain (trade first).
 *   2. Persist the entry receipt (POST /api/receipts or in-app flow).
 *   3. Run gate-check elsewhere; pass its output in — this script does not re-run it.
 *
 * Usage:
 *   npx tsx scripts/publish-desk-card.ts path/to/desk-card.json
 *   DESK_API_BASE=http://localhost:3000 npx tsx scripts/publish-desk-card.ts card.json
 *   DESK_DRY_RUN=1 npx tsx scripts/publish-desk-card.ts card.json
 *
 * JSON shape:
 * {
 *   "handle": "desk",
 *   "thesis": "...",
 *   "trade": {
 *     "fromAsset": "cash",
 *     "fromChain": "Base",
 *     "toAsset": "token",
 *     "token": { "chainId": 8453, "address": "0x...", "symbol": "SURPLUS" },
 *     "toChain": "Base",
 *     "sizeUsd": 8
 *   },
 *   "receiptSlug": "abc123",
 *   "whyNow": [{ "at": "2026-07-14T12:00:00.000Z", "event": "..." }],
 *   "whatBreaksIt": "...",
 *   "gateReport": [{ "name": "UA routability", "passed": true }]
 * }
 *
 * For DESK_DRY_RUN, also set "entryAt" (ISO) so local validation can run
 * without hitting the API.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildDeskCard,
  parseConvictionTrade,
  parseGateReport,
  parseWhatBreaksIt,
  parseWhyNow,
} from "../src/lib/verbs/conviction";

type DeskCardFile = {
  handle?: unknown;
  thesis?: unknown;
  trade?: unknown;
  receiptSlug?: unknown;
  entryAt?: unknown;
  whyNow?: unknown;
  whatBreaksIt?: unknown;
  gateReport?: unknown;
  publishedAt?: unknown;
};

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: npx tsx scripts/publish-desk-card.ts <card.json>");
    process.exit(1);
  }

  const raw = JSON.parse(
    readFileSync(resolve(fileArg), "utf8"),
  ) as DeskCardFile;

  if (typeof raw.handle !== "string" || !raw.handle.trim()) {
    console.error("handle required");
    process.exit(1);
  }
  if (typeof raw.thesis !== "string" || !raw.thesis.trim()) {
    console.error("thesis required");
    process.exit(1);
  }
  if (typeof raw.receiptSlug !== "string" || !raw.receiptSlug.trim()) {
    console.error("receiptSlug required");
    process.exit(1);
  }

  const trade = parseConvictionTrade(raw.trade);
  if (!trade) {
    console.error("invalid trade payload");
    process.exit(1);
  }
  const whyNow = parseWhyNow(raw.whyNow);
  if (!whyNow?.length) {
    console.error("whyNow required (non-empty)");
    process.exit(1);
  }
  const whatBreaksIt = parseWhatBreaksIt(raw.whatBreaksIt);
  if (!whatBreaksIt) {
    console.error("whatBreaksIt required");
    process.exit(1);
  }
  const gateReport = parseGateReport(raw.gateReport);
  if (!gateReport?.length) {
    console.error("gateReport required (non-empty)");
    process.exit(1);
  }

  const apiBase = (process.env.DESK_API_BASE ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const dryRun = process.env.DESK_DRY_RUN === "1";
  const receiptSlug = raw.receiptSlug.trim();

  let entryAt: string;
  if (typeof raw.entryAt === "string" && raw.entryAt.trim()) {
    entryAt = raw.entryAt.trim();
  } else if (dryRun) {
    console.error("DESK_DRY_RUN requires entryAt in the JSON file.");
    process.exit(1);
  } else {
    const receiptRes = await fetch(
      `${apiBase}/api/receipts?slug=${encodeURIComponent(receiptSlug)}`,
    );
    if (!receiptRes.ok) {
      console.error(
        `Receipt ${receiptSlug} not found (${receiptRes.status}). Persist it first.`,
      );
      process.exit(1);
    }
    const receiptBody = (await receiptRes.json()) as { entryAt?: string };
    if (!receiptBody.entryAt) {
      console.error("Receipt response missing entryAt.");
      process.exit(1);
    }
    entryAt = receiptBody.entryAt;
  }

  const publishedAt =
    typeof raw.publishedAt === "string" && raw.publishedAt.trim()
      ? raw.publishedAt.trim()
      : new Date().toISOString();

  let entry;
  try {
    entry = buildDeskCard({
      handle: raw.handle.trim(),
      thesis: raw.thesis,
      trade,
      receiptSlug,
      entryAt,
      whyNow,
      whatBreaksIt,
      gateReport,
      publishedAt,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (dryRun) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  const res = await fetch(`${apiBase}/api/convictions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: entry.handle,
      thesis: entry.thesis,
      trade: entry.trade,
      receiptSlug: entry.receiptSlug,
      whyNow: entry.whyNow,
      whatBreaksIt: entry.whatBreaksIt,
      gateReport: entry.gateReport,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    entryId?: string;
    error?: string;
    persisted?: boolean;
  };

  if (!res.ok) {
    console.error(`POST failed (${res.status}):`, body.error ?? body);
    process.exit(1);
  }

  console.log(
    `Published desk card ${body.entryId ?? entry.entryId}` +
      (body.persisted ? " (persisted)" : " (memory)"),
  );
  if (entry.trade.token) {
    console.log(
      `TokenRef: ${entry.trade.token.symbol} ${entry.trade.token.address} (chain ${entry.trade.token.chainId})`,
    );
  }
  console.log(
    `Receipt: ${entry.receiptSlug} (entry ${entryAt} ≤ pub ${publishedAt})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
