import { describe, expect, it } from "vitest";

import { COMPACT_THESIS_MAX_CHARS } from "@conviction/mcp/agent-reads-contract";
import { loadAgentAccountStatus } from "@/lib/agent-account-status";
import {
  compactThesis,
  decodeConvictionCursor,
  encodeConvictionCursor,
  toCompactConviction,
  toConvictionAttribution,
} from "@/lib/agent-network-reads";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import type { ConvictionEntry } from "@/lib/verbs/types";

const ENTRY: ConvictionEntry = {
  entryId: "entry-1",
  handle: "scout",
  thesis: "A".repeat(COMPACT_THESIS_MAX_CHARS + 40),
  trade: {
    fromAsset: "cash",
    fromChain: "Base",
    toAsset: "token",
    token: {
      chainId: 8453,
      address: "0xabc",
      symbol: "SURPLUS",
    },
    toChain: "Base",
    sizeUsd: 12,
  },
  createdAt: "2026-07-15T18:00:00.000Z",
  backedBy: ["alice", "bob"],
  receiptSlug: "receipt-1",
  whyNow: [{ at: "2026-07-14T12:00:00.000Z", event: "Depth cleared." }],
  whatBreaksIt: "LP unlock.",
  gateReport: [
    { name: "liquidity", passed: true },
    { name: "route", passed: false },
  ],
};

function sampleAgent(): OwnedAgent {
  return {
    agentId: "00000000-0000-4000-8000-0000000000b1",
    ownerUserId: "user-1",
    handle: "lease-scout",
    authorKind: "agent",
    operatorHandle: "operator",
    address: "0x00000000000000000000000000000000000000Aa",
    returnAddress: "0x0000000000000000000000000000000000000001",
    status: "active",
    publicStatus: "active",
    actionPolicy: { trade: true, back: false, publish: true },
    maxTradeUsd: 25,
    spendBudgetUsd: 100,
    lifetimeSpendUsd: 40,
    fundingReady: true,
    setupVerifiedAt: null,
    createdAt: "2026-07-17T12:00:00.000Z",
  };
}

describe("agent-network-reads", () => {
  it("compacts list rows with truncated thesis and anatomy summary", () => {
    const compact = toCompactConviction(ENTRY);
    expect(compact.thesis.length).toBeLessThanOrEqual(COMPACT_THESIS_MAX_CHARS);
    expect(compact.thesis.endsWith("…")).toBe(true);
    expect(compact.backerCount).toBe(2);
    expect(compact.trade.tokenSymbol).toBe("SURPLUS");
    expect(compact.anatomy).toEqual({
      whyNowCount: 1,
      hasWhatBreaksIt: true,
      gatePassed: 1,
      gateFailed: 1,
    });
    expect(compactThesis("short")).toBe("short");
  });

  it("exposes current attribution separately from the canonical entry", () => {
    expect(toConvictionAttribution(ENTRY)).toEqual({
      backerCount: 2,
      backedBy: ["alice", "bob"],
      backers: [{ handle: "alice" }, { handle: "bob" }],
    });
  });

  it("round-trips keyset cursors", () => {
    const encoded = encodeConvictionCursor(ENTRY);
    expect(decodeConvictionCursor(encoded)).toEqual({
      createdAt: ENTRY.createdAt,
      entryId: ENTRY.entryId,
    });
    expect(decodeConvictionCursor("not-a-cursor")).toBeNull();
  });

  it("loads account status with unified balance and deposit addresses", async () => {
    const status = await loadAgentAccountStatus(sampleAgent());
    expect(status.ok).toBe(true);
    expect(status.remainingBudgetUsd).toBe(60);
    expect(status.balance.totalUsd).toBeGreaterThan(0);
    expect(status.depositAddresses.evm).toBeTruthy();
    expect(status.depositAddress).toBe(status.depositAddresses.evm);
    expect(JSON.stringify(status)).not.toMatch(
      /privateKey|mnemonic|keystore|signature/i,
    );
  });
});
