// LLM-backed intent parser (ADR 0012). The model maps plain English into the
// SAME constrained intent schema the deterministic parser emits — it never sees
// the balance and never decides validity; the verb layer (validateIntent) still
// owns that. Runs server-side via the Vercel AI Gateway so the key stays off the
// client. Falls back to the deterministic parser when the gateway is unconfigured
// or the call fails, keeping behavior identical to no-LLM mode (and CI offline).

import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import {
  CLARIFY_AMOUNT,
  DEFAULT_DEST_CHAIN,
  DEFAULT_TO_ASSET,
  PARSER_ASSETS,
  parseIntentHeuristic,
} from "@/lib/verbs/intent";
import { IS_LLM_PARSING, LLM_MODEL } from "@/lib/env";
import type { ParseResult, ProductAsset, TradeIntent } from "@/lib/verbs/types";

const SYSTEM = `You convert a person's plain-English money request into a constrained trade intent for a dollars-first app. The settlement is always cash on Arbitrum; you only decide the asset(s) and amount.

Supported assets: cash (also "dollars"/"usd"/"money"), eth, btc, sol, usdc, usdt.

Rules:
- "buy/get/spend ... on ETH", "into BTC" → the asset being acquired is toAsset (e.g. eth, btc, sol).
- "move/convert/cash out/to cash" with no other asset → toAsset is "cash".
- "sell/convert/move my ETH ..." → fromAsset is that asset (eth/btc/sol); never set fromAsset to cash.
- Amount: set sizeUsd for a dollar figure ("$25", "25 dollars"). set fraction (0-1) for "half"=0.5, "all"/"everything"=1, "a quarter"=0.25, "25%"=0.25.
- A bare token quantity like "0.5 ETH" is NOT an amount — it does not set sizeUsd or fraction.
- NEVER invent an amount. If neither a dollar figure nor a fraction is present, set kind="clarify" and leave the amount fields null.
- If the request is empty or you cannot tell what they want, set kind="clarify".
- Only ever emit the supported assets above; if an unsupported asset is named, still return it as toAsset and let downstream validation reject it.`;

const SCHEMA = z.object({
  kind: z.enum(["intent", "clarify"]),
  fromAsset: z.enum(PARSER_ASSETS as [string, ...string[]]).nullable(),
  toAsset: z.enum(PARSER_ASSETS as [string, ...string[]]).nullable(),
  sizeUsd: z.number().positive().nullable(),
  fraction: z.number().min(0).max(1).nullable(),
});

type RawParse = z.infer<typeof SCHEMA>;

function rawToParseResult(raw: RawParse): ParseResult {
  // Mirror the deterministic guard: an intent with no amount is a clarify, so we
  // never silently infer "all" (ADR 0012).
  const hasAmount = raw.sizeUsd != null || raw.fraction != null;
  if (raw.kind === "clarify" || !hasAmount) {
    return { kind: "clarify", question: CLARIFY_AMOUNT };
  }

  const intent: TradeIntent = {
    toAsset: (raw.toAsset as ProductAsset) ?? DEFAULT_TO_ASSET,
    destChain: DEFAULT_DEST_CHAIN,
  };
  if (raw.fromAsset && raw.fromAsset !== "cash") {
    intent.fromAsset = raw.fromAsset as ProductAsset;
  }
  // sizeUsd takes precedence over fraction (they are mutually exclusive).
  if (raw.sizeUsd != null) {
    intent.sizeUsd = raw.sizeUsd;
  } else if (raw.fraction != null) {
    intent.fraction = raw.fraction;
  }

  return { kind: "intent", intent };
}

/**
 * Parse plain English into a constrained intent. Uses the LLM via the AI Gateway
 * when configured; otherwise (or on any failure) falls back to the deterministic
 * heuristic parser so the path is always safe and offline-capable.
 */
export async function parseIntentLLM(text: string): Promise<ParseResult> {
  if (!IS_LLM_PARSING) {
    return parseIntentHeuristic(text);
  }

  try {
    const { object } = await generateObject({
      model: LLM_MODEL,
      schema: SCHEMA,
      system: SYSTEM,
      prompt: text,
    });
    return rawToParseResult(object);
  } catch {
    // Gateway down, rate-limited, malformed output — degrade to the heuristic.
    return parseIntentHeuristic(text);
  }
}
