// LLM-backed feed digest (issue #6). Flags stay deterministic; the model only
// refines prose. Mirrors intent-llm.ts: gated by IS_LLM_PARSING, falls back on
// any failure so CI stays offline (ADR 0014).

import "server-only";
import { generateText } from "ai";
import { IS_LLM_PARSING, LLM_MODEL } from "@/lib/env";
import {
  buildDigest,
  type FlaggedConviction,
} from "@/lib/verbs/feed-summary";
import type { ConvictionEntry } from "@/lib/verbs/types";

const SYSTEM = `You write a short, plain-English summary of a social trading feed for a dollars-first app. No jargon (no bridge, gas, chain, token). Use handles with @. One or two paragraphs max. Mention how many convictions, who is active, what assets people are moving into, and call out any flagged posts the system already identified — do not invent new flags.`;

function entriesPayload(entries: ConvictionEntry[]): string {
  return entries
    .map(
      (e) =>
        `- @${e.handle}: ${e.thesis.slice(0, 200)} | $${e.trade.sizeUsd} into ${e.trade.toAsset}`,
    )
    .join("\n");
}

function flaggedPayload(flagged: FlaggedConviction[]): string {
  if (flagged.length === 0) return "None.";
  return flagged
    .map((f) => `- @${f.handle} (${f.entryId}): ${f.reason}`)
    .join("\n");
}

/**
 * Produce a feed digest. Uses the LLM when configured; otherwise (or on error)
 * returns the deterministic template from buildDigest.
 */
export async function summarizeFeedDigest(
  entries: ConvictionEntry[],
  flagged: FlaggedConviction[],
): Promise<string> {
  const fallback = buildDigest(entries, flagged);

  if (!IS_LLM_PARSING) {
    return fallback;
  }

  try {
    const { text } = await generateText({
      model: LLM_MODEL,
      system: SYSTEM,
      prompt: `Feed entries:\n${entriesPayload(entries) || "(empty)"}\n\nAlready flagged (do not add new ones):\n${flaggedPayload(flagged)}\n\nWrite a concise digest.`,
    });
    const trimmed = text.trim();
    return trimmed || fallback;
  } catch {
    return fallback;
  }
}
