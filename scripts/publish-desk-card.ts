#!/usr/bin/env npx tsx
/**
 * Publish a full-anatomy desk card through the verb layer (issue #27 / ADR 0016).
 * Thin client: validation + assembly live in `parseDeskCardFields` / `buildDeskCard`.
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
 * For DESK_DRY_RUN, set "entryAt" (ISO) in the JSON so local validation can run
 * without hitting the API. Live publish lets the server resolve entryAt from
 * the receipt store.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildDeskCard,
  parseDeskCardFields,
} from "../src/lib/verbs/conviction";

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: npx tsx scripts/publish-desk-card.ts <card.json>");
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(fileArg), "utf8"));
  } catch {
    console.error(`Failed to read JSON from ${fileArg}`);
    process.exit(1);
  }

  const parsed = parseDeskCardFields(raw);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }

  const apiBase = (process.env.DESK_API_BASE ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const dryRun = process.env.DESK_DRY_RUN === "1";
  const fields = parsed.value;

  if (dryRun) {
    if (!fields.entryAt) {
      console.error("DESK_DRY_RUN requires entryAt in the JSON file.");
      process.exit(1);
    }
    try {
      const entry = buildDeskCard({
        ...fields,
        entryAt: fields.entryAt,
      });
      console.log(JSON.stringify(entry, null, 2));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    return;
  }

  // Live: server owns entryAt lookup + buildDeskCard (same path as any client).
  const res = await fetch(`${apiBase}/api/convictions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: fields.handle,
      thesis: fields.thesis,
      trade: fields.trade,
      receiptSlug: fields.receiptSlug,
      whyNow: fields.whyNow,
      whatBreaksIt: fields.whatBreaksIt,
      gateReport: fields.gateReport,
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
    `Published desk card ${body.entryId ?? "(unknown)"}` +
      (body.persisted ? " (persisted)" : " (memory)"),
  );
  if (fields.trade.token) {
    console.log(
      `TokenRef: ${fields.trade.token.symbol} ${fields.trade.token.address} (chain ${fields.trade.token.chainId})`,
    );
  }
  console.log(`Receipt: ${fields.receiptSlug}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
