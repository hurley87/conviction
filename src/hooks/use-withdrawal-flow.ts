"use client";

// State machine for Settings → external-wallet withdrawals.
// edit → quoting → confirm → executing → success | error (with recover path).

import { useCallback, useEffect, useRef, useState } from "react";
import type { UAClient } from "@/lib/ua/types";
import type {
  DestChain,
  TradeSigners,
  UniversalBalance,
  WithdrawalAsset,
  WithdrawalQuote,
  WithdrawalResult,
} from "@/lib/verbs/types";
import { WithdrawalStaleQuoteError } from "@/lib/verbs/types";
import {
  narrateWithdrawal,
  requestFromQuote,
  sendActivityId,
  supportedWithdrawalChains,
  validateWithdrawal,
  withdrawalAssetLabel,
} from "@/lib/verbs/withdrawal";

export type WithdrawalDraft = {
  asset: WithdrawalAsset;
  destChain: DestChain;
  amountRaw: string;
  destinationRaw: string;
};

type FlowState =
  | { status: "edit"; draft: WithdrawalDraft; error: string | null }
  | { status: "quoting"; draft: WithdrawalDraft }
  | {
      status: "confirm";
      draft: WithdrawalDraft;
      quote: WithdrawalQuote;
      /** Shown when execute re-quoted above the debit ceiling. */
      requoteNotice?: string | null;
    }
  | {
      status: "executing";
      draft: WithdrawalDraft;
      quote: WithdrawalQuote;
    }
  | { status: "success"; result: WithdrawalResult }
  | {
      status: "error";
      draft: WithdrawalDraft;
      quote: WithdrawalQuote | null;
      message: string;
    };

const DEFAULT_DRAFT: WithdrawalDraft = {
  asset: "usdc",
  destChain: "Arbitrum",
  amountRaw: "",
  destinationRaw: "",
};

function defaultChainFor(asset: WithdrawalAsset): DestChain {
  return supportedWithdrawalChains(asset)[0] ?? "Arbitrum";
}

function draftFrom(state: FlowState): WithdrawalDraft {
  if (state.status === "success") return DEFAULT_DRAFT;
  return state.draft;
}

export type UseWithdrawalFlowArgs = {
  ua: UAClient | null;
  signers: TradeSigners;
  ownerAddress: string | null | undefined;
  balance: UniversalBalance | null | undefined;
  handle: string | null | undefined;
  onSuccess?: () => Promise<void> | void;
  onUpgraded?: () => void;
};

export function useWithdrawalFlow({
  ua,
  signers,
  ownerAddress,
  balance,
  handle,
  onSuccess,
  onUpgraded,
}: UseWithdrawalFlowArgs) {
  const [flow, setFlow] = useState<FlowState>({
    status: "edit",
    draft: DEFAULT_DRAFT,
    error: null,
  });
  const flowRef = useRef(flow);
  const executingRef = useRef(false);

  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  const setDraft = useCallback((patch: Partial<WithdrawalDraft>) => {
    setFlow((prev) => {
      if (prev.status !== "edit" && prev.status !== "error") return prev;
      const draft = { ...prev.draft, ...patch };
      if (patch.asset && !patch.destChain) {
        const chains = supportedWithdrawalChains(patch.asset);
        if (!chains.includes(draft.destChain)) {
          draft.destChain = defaultChainFor(patch.asset);
        }
      }
      return { status: "edit", draft, error: null };
    });
  }, []);

  const reset = useCallback(() => {
    executingRef.current = false;
    setFlow({ status: "edit", draft: DEFAULT_DRAFT, error: null });
  }, []);

  const backToEdit = useCallback(() => {
    executingRef.current = false;
    setFlow((prev) => ({
      status: "edit",
      draft: draftFrom(prev),
      error: null,
    }));
  }, []);

  const requestQuote = useCallback(async () => {
    const draft = draftFrom(flowRef.current);
    if (!ua) {
      setFlow({ status: "edit", draft, error: "Wallet is not ready yet." });
      return;
    }

    const validated = validateWithdrawal({
      asset: draft.asset,
      destChain: draft.destChain,
      amountRaw: draft.amountRaw,
      destinationRaw: draft.destinationRaw,
      ownerAddress,
      balance,
    });
    if (!validated.ok) {
      setFlow({ status: "edit", draft, error: validated.error });
      return;
    }

    setFlow({ status: "quoting", draft });
    try {
      const quote = await ua.quoteWithdrawal({ request: validated.request });
      setFlow({ status: "confirm", draft, quote, requoteNotice: null });
    } catch (err) {
      setFlow({
        status: "edit",
        draft,
        error:
          err instanceof Error
            ? err.message
            : "Could not get a quote. Try again.",
      });
    }
  }, [ua, ownerAddress, balance]);

  const confirmSend = useCallback(async () => {
    if (executingRef.current) return;
    const current = flowRef.current;
    if (!ua || current.status !== "confirm") return;

    const { draft, quote } = current;
    executingRef.current = true;
    setFlow({ status: "executing", draft, quote });

    try {
      const result = await ua.executeWithdrawal({
        agreedQuote: quote,
        signers,
      });

      if (handle) {
        const request = requestFromQuote(quote);
        void fetch("/api/activity", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: sendActivityId(result.transactionId),
            handle,
            kind: "send",
            summary: result.summary || narrateWithdrawal(request),
            amountUsd: result.estimatedDebitUsd,
            receiptSlug: null,
            metadata: {
              asset: result.asset,
              assetLabel: withdrawalAssetLabel(result.asset),
              destChain: result.destChain,
              amount: result.amount,
              destination: result.destination,
              feeUsd: result.feeUsd,
              transactionId: result.transactionId,
            },
          }),
        }).catch(() => {});
      }

      if (result.signed7702Auth) {
        onUpgraded?.();
      }
      // Balance refresh must not veto a completed on-chain send.
      void Promise.resolve(onSuccess?.()).catch(() => {});
      setFlow({ status: "success", result });
    } catch (err) {
      if (err instanceof WithdrawalStaleQuoteError) {
        setFlow({
          status: "confirm",
          draft,
          quote: err.freshQuote,
          requoteNotice: "The quote moved — please confirm the new estimate.",
        });
        return;
      }
      setFlow({
        status: "error",
        draft,
        quote,
        message:
          err instanceof Error
            ? err.message
            : "Withdrawal failed. Please try again.",
      });
    } finally {
      executingRef.current = false;
    }
  }, [ua, signers, handle, onSuccess, onUpgraded]);

  return {
    flow,
    setDraft,
    requestQuote,
    confirmSend,
    backToEdit,
    reset,
  };
}
