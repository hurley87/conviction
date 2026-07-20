import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OperatorFinalityLegView,
} from "@/components/agent-access/operator-finality-panel";
import type { OperatorFinalityLeg } from "@/lib/agent-operator-finality";

const BASE_LEG: OperatorFinalityLeg = {
  legId: "destination:42161:0",
  action: "destination",
  chainId: 42161,
  chainName: "Arbitrum",
  required: true,
  status: "pending",
  transactionId: `0x${"9".repeat(64)}`,
  quote: null,
  confirmedHashes: [],
  lastNormalizedStatus: "pending",
  lastProviderStatus: "PENDING",
  attemptCount: 2,
  lastError: null,
  submittedAt: "2026-07-19T18:00:00.000Z",
  confirmedAt: null,
  updatedAt: "2026-07-19T18:00:00.000Z",
  evidence: [],
};

describe("OperatorFinalityLegView", () => {
  it("links confirmed hashes and never links planned or unconfirmed hashes", () => {
    const pending = renderToStaticMarkup(
      createElement(OperatorFinalityLegView, { leg: BASE_LEG }),
    );
    expect(pending).not.toContain("<a");
    expect(pending).not.toContain(BASE_LEG.transactionId);

    const confirmedHash = `0x${"a".repeat(64)}`;
    const confirmed = renderToStaticMarkup(
      createElement(OperatorFinalityLegView, {
        leg: {
          ...BASE_LEG,
          status: "finalized",
          confirmedHashes: [
            {
              hash: confirmedHash,
              explorerUrl: `https://arbiscan.io/tx/${confirmedHash}`,
              chainId: 42161,
              chainName: "Arbitrum",
            },
          ],
        },
      }),
    );
    expect(confirmed).toContain("<a");
    expect(confirmed).toContain(`https://arbiscan.io/tx/${confirmedHash}`);
    expect(confirmed).not.toContain(BASE_LEG.transactionId);
  });
});
