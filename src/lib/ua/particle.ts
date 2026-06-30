// Real Universal Account client backed by Particle's SDK in EIP-7702 mode
// (ADR 0004). The SDK is dynamically imported so it never executes during SSR
// or the static build — only client-side at call time.

import type {
  ExecuteTradeParams,
  QuoteTradeParams,
  UAClient,
  UpgradeResult,
} from "@/lib/ua/types";
import {
  buildBuyPayload,
  defaultTradeConfig,
  type RawTransaction,
  userOpsNeeding7702,
} from "@/lib/ua/trade";
import { buildReceipt } from "@/lib/verbs/receipt";
import { shapeQuote, isBelowFloor } from "@/lib/verbs/quote";
import { narrateResult } from "@/lib/verbs/intent";
import {
  FloorAbortError,
  type TradeQuote,
  type TradeResult,
  type UniversalBalance,
  type DepositAddresses,
} from "@/lib/verbs/types";
import { toUniversalBalance, type RawPrimaryAssets } from "@/lib/verbs/map-balance";

export type ParticleConfig = {
  ownerAddress: string;
  projectId: string;
  projectClientKey: string;
  projectAppUuid: string;
};

/** Minimal structural surface of the SDK account object we depend on. */
type ParticleAccount = {
  getPrimaryAssets(): Promise<RawPrimaryAssets>;
  getSmartAccountOptions(): Promise<{
    smartAccountAddress?: string;
    solanaSmartAccountAddress?: string;
    ownerAddress: string;
  }>;
  createBuyTransaction(
    payload: { token: { chainId: number; address: string }; amountInUSD: string },
    tradeConfig?: Record<string, unknown>,
  ): Promise<RawTransaction>;
  sendTransaction(
    transaction: RawTransaction,
    signature: string,
    authorizations?: { userOpHash: string; signature: string }[],
  ): Promise<{ transactionId?: string }>;
};

export function createParticleUAClient(config: ParticleConfig): UAClient {
  let accountPromise: Promise<unknown> | null = null;

  async function account(): Promise<ParticleAccount> {
    if (!accountPromise) {
      accountPromise = (async () => {
        const { UniversalAccount } = await import(
          "@particle-network/universal-account-sdk"
        );
        return new UniversalAccount({
          projectId: config.projectId,
          projectClientKey: config.projectClientKey,
          projectAppUuid: config.projectAppUuid,
          ownerAddress: config.ownerAddress,
          smartAccountOptions: { useEIP7702: true },
        });
      })();
    }
    return accountPromise as Promise<ParticleAccount>;
  }

  async function createTradeTransaction(
    params: QuoteTradeParams,
  ): Promise<RawTransaction> {
    const ua = await account();
    return ua.createBuyTransaction(
      buildBuyPayload(params.intent, params.sizeUsd),
      defaultTradeConfig(params.intent.fromAsset),
    );
  }

  return {
    async getUniversalBalance(): Promise<UniversalBalance> {
      const ua = await account();
      return toUniversalBalance(await ua.getPrimaryAssets());
    },

    async getDepositAddresses(): Promise<DepositAddresses> {
      const ua = await account();
      const opts = await ua.getSmartAccountOptions();
      return {
        evm: opts.smartAccountAddress ?? config.ownerAddress,
        solana: opts.solanaSmartAccountAddress ?? null,
      };
    },

    async ensureUpgraded(): Promise<UpgradeResult> {
      return { upgraded: false, alreadyUpgraded: true };
    },

    async quoteTrade(params: QuoteTradeParams): Promise<TradeQuote> {
      const raw = await createTradeTransaction(params);
      const txId = raw.transactionId ?? `quote-${Date.now()}`;
      return shapeQuote(
        raw.tokenChanges ?? {},
        params.intent,
        params.sizeUsd,
        txId,
        raw,
      );
    },

    async executeTrade(params: ExecuteTradeParams): Promise<TradeResult> {
      const { intent, sizeUsd, agreedQuote, signers, receiptSlug } = params;
      const raw = await createTradeTransaction({ intent, sizeUsd });

      const freshQuote = shapeQuote(
        raw.tokenChanges ?? {},
        intent,
        sizeUsd,
        raw.transactionId ?? agreedQuote.transactionId,
        raw,
      );

      if (isBelowFloor(freshQuote.dollarsOut, agreedQuote.floorUsd)) {
        throw new FloorAbortError(
          "The quote moved — please confirm again.",
          freshQuote,
        );
      }

      if (!raw.rootHash) {
        throw new Error("Transaction missing root hash");
      }

      const rootHashSig = await signers.signRootHash(raw.rootHash);

      const authorizations: { userOpHash: string; signature: string }[] = [];
      for (const pending of userOpsNeeding7702(raw.userOps)) {
        const sig = await signers.sign7702(pending.auth);
        authorizations.push({
          userOpHash: pending.userOpHash,
          signature: sig,
        });
      }

      const ua = await account();
      const result = await ua.sendTransaction(
        raw,
        rootHashSig,
        authorizations,
      );

      const transactionId =
        result.transactionId ?? raw.transactionId ?? agreedQuote.transactionId;

      // Amounts come from the executed quote — the SDK's getTransaction status
      // object does not carry USD totals (it would zero the receipt). Legs come
      // from the signed transaction's per-chain userOps.
      const receipt = buildReceipt(
        receiptSlug,
        {
          dollarsIn: freshQuote.dollarsIn,
          dollarsOut: freshQuote.dollarsOut,
          feeUsd: freshQuote.feeUsd,
          sourceChain: freshQuote.sourceChain,
          destChain: freshQuote.destChain,
        },
        raw.userOps,
      );

      return {
        transactionId,
        summary: narrateResult(freshQuote.dollarsIn, freshQuote.dollarsOut),
        receipt,
      };
    },
  };
}
