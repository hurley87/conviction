// Real Universal Account client backed by Particle's SDK in EIP-7702 mode
// (ADR 0004). The SDK is dynamically imported so it never executes during SSR
// or the static build — only client-side at call time.

import type {
  ExecuteTradeParams,
  ExecuteWithdrawalParams,
  QuoteTradeParams,
  QuoteWithdrawalParams,
  UAClient,
  UpgradeResult,
} from "@/lib/ua/types";
import {
  buildBuyPayload,
  buildConvertPayload,
  defaultTradeConfig,
  isSellIntent,
  signAndSendRaw,
  type RawTransaction,
} from "@/lib/ua/trade";
import { buildReceipt, inferSpentSymbol } from "@/lib/verbs/receipt";
import {
  assertTradeDebitWithinCeiling,
  shapeQuote,
  isBelowFloor,
} from "@/lib/verbs/quote";
import { narrateResult } from "@/lib/verbs/intent";
import {
  isAboveMaxDebit,
  narrateWithdrawal,
  requestFromQuote,
  shapeWithdrawalQuote,
  withdrawalTokenRef,
} from "@/lib/verbs/withdrawal";
import {
  FloorAbortError,
  WithdrawalStaleQuoteError,
  type TradeQuote,
  type TradeResult,
  type UniversalBalance,
  type DepositAddresses,
  type WithdrawalQuote,
  type WithdrawalResult,
} from "@/lib/verbs/types";
import { toUniversalBalance, type RawPrimaryAssets } from "@/lib/verbs/map-balance";
import {
  warmUpTokenPair,
  type WarmUpAccount,
} from "@/lib/ua/warm-up";
import { readParticleTransactionStatus } from "@/lib/ua/particle-finality";

export type ParticleConfig = {
  ownerAddress: string;
  projectId: string;
  projectClientKey: string;
  projectAppUuid: string;
};

/** Minimal structural surface of the SDK account object we depend on. */
export type ParticleAccount = WarmUpAccount & {
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
  createConvertTransaction(
    payload: { chainId: number; expectToken: { type: string; amount: string } },
    tradeConfig?: Record<string, unknown>,
  ): Promise<RawTransaction>;
  createTransferTransaction(payload: {
    token: { chainId: number; address: string };
    amount: string;
    receiver: string;
  }): Promise<RawTransaction>;
  sendTransaction(
    transaction: RawTransaction,
    signature: string,
    authorizations?: { userOpHash: string; signature: string }[],
  ): Promise<{ transactionId?: string }>;
  getTransaction(transactionId: string): Promise<unknown>;
};

/** Shared Particle account construction for the UA client and desk CLIs. */
export async function createParticleAccount(
  config: ParticleConfig,
): Promise<ParticleAccount> {
  const { UniversalAccount, UNIVERSAL_ACCOUNT_VERSION_V2 } = await import(
    "@particle-network/universal-account-sdk"
  );
  return new UniversalAccount({
    projectId: config.projectId,
    projectClientKey: config.projectClientKey,
    projectAppUuid: config.projectAppUuid,
    // v2.0.x moved the owner into smartAccountOptions and requires
    // name + version; the old top-level ownerAddress shape is rejected
    // by the backend as "Invalid parameters".
    smartAccountOptions: {
      name: "UNIVERSAL",
      version: UNIVERSAL_ACCOUNT_VERSION_V2,
      ownerAddress: config.ownerAddress,
      useEIP7702: true,
    },
  }) as ParticleAccount;
}

export function createParticleUAClient(config: ParticleConfig): UAClient {
  let accountPromise: Promise<ParticleAccount> | null = null;

  async function sdk() {
    return import("@particle-network/universal-account-sdk");
  }

  async function account(): Promise<ParticleAccount> {
    if (!accountPromise) {
      accountPromise = createParticleAccount(config);
    }
    return accountPromise;
  }

  /** True when the token is a plain v2 buy target (a primary of a buyable
   * type). Everything else needs the warm-up flow. */
  async function isPlainBuyTarget(token: {
    chainId: number;
    address: string;
  }): Promise<boolean> {
    const mod = await sdk();
    const supported = mod.getSupportedToken(token.chainId, token.address);
    const buyableTypes: string[] =
      mod.UNIVERSAL_ACCOUNT_VERSION_V2_SUPPORTED_TOKEN_TYPES ?? [];
    return supported?.type != null && buyableTypes.includes(supported.type);
  }

  async function createTradeTransaction(
    params: QuoteTradeParams,
  ): Promise<RawTransaction> {
    const ua = await account();
    const { intent, sizeUsd } = params;
    // Selling a primary token (e.g. ETH → cash) must use the convert method;
    // the SDK rejects it via createBuyTransaction (ADR 0004).
    if (isSellIntent(intent)) {
      return ua.createConvertTransaction(
        buildConvertPayload(intent, sizeUsd),
        defaultTradeConfig(intent.fromAsset),
      );
    }
    const payload = buildBuyPayload(intent, sizeUsd);
    if (await isPlainBuyTarget(payload.token)) {
      return ua.createBuyTransaction(payload, defaultTradeConfig(intent.fromAsset));
    }
    const tokenPair = await warmUpTokenPair(ua, payload.token);
    return ua.createBuyTransaction(payload, {
      ...defaultTradeConfig(intent.fromAsset),
      tokenPair,
    });
  }

  async function createTransferRaw(
    request: QuoteWithdrawalParams["request"],
  ): Promise<RawTransaction> {
    const token = withdrawalTokenRef(request.asset, request.destChain);
    if (!token) {
      throw new Error(
        `Unsupported withdrawal: ${request.asset} on ${request.destChain}`,
      );
    }
    const ua = await account();
    return ua.createTransferTransaction({
      token,
      amount: request.amount,
      receiver: request.destination,
    });
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

    async getTransactionStatus(transactionId) {
      return readParticleTransactionStatus(await account(), transactionId);
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

      assertTradeDebitWithinCeiling(
        raw.tokenChanges ?? {},
        agreedQuote.dollarsIn,
      );
      if (isBelowFloor(freshQuote.dollarsOut, agreedQuote.floorUsd)) {
        throw new FloorAbortError(
          "The quote moved — please confirm again.",
          freshQuote,
        );
      }

      const ua = await account();
      const { transactionId, signed7702Auth } = await signAndSendRaw(
        raw,
        signers,
        (transaction, signature, authorizations) =>
          ua.sendTransaction(transaction, signature, authorizations),
        agreedQuote.transactionId,
      );

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
          toAsset: freshQuote.toAsset,
          receivedSymbol: freshQuote.receivedSymbol,
          sourceSymbol: inferSpentSymbol(intent),
        },
        raw.userOps,
      );

      return {
        transactionId,
        summary: narrateResult(
          freshQuote.dollarsIn,
          freshQuote.dollarsOut,
          freshQuote.toAsset,
          freshQuote.receivedSymbol,
        ),
        receipt,
        signed7702Auth,
      };
    },

    async quoteWithdrawal(
      params: QuoteWithdrawalParams,
    ): Promise<WithdrawalQuote> {
      const raw = await createTransferRaw(params.request);
      const txId = raw.transactionId ?? `withdraw-quote-${Date.now()}`;
      return shapeWithdrawalQuote(
        raw.tokenChanges ?? {},
        params.request,
        txId,
        raw,
      );
    },

    async executeWithdrawal(
      params: ExecuteWithdrawalParams,
    ): Promise<WithdrawalResult> {
      const { agreedQuote, signers } = params;
      const request = requestFromQuote(agreedQuote);
      const raw = await createTransferRaw(request);

      const freshQuote = shapeWithdrawalQuote(
        raw.tokenChanges ?? {},
        request,
        raw.transactionId ?? agreedQuote.transactionId,
        raw,
      );

      if (isAboveMaxDebit(freshQuote.estimatedDebitUsd, agreedQuote.maxDebitUsd)) {
        throw new WithdrawalStaleQuoteError(
          "The quote moved — please confirm again.",
          freshQuote,
        );
      }

      const ua = await account();
      const { transactionId, signed7702Auth } = await signAndSendRaw(
        raw,
        signers,
        (transaction, signature, authorizations) =>
          ua.sendTransaction(transaction, signature, authorizations),
        agreedQuote.transactionId,
      );

      return {
        transactionId,
        summary: narrateWithdrawal(request),
        estimatedDebitUsd: freshQuote.estimatedDebitUsd,
        feeUsd: freshQuote.feeUsd,
        asset: request.asset,
        destChain: request.destChain,
        amount: request.amount,
        destination: request.destination,
        signed7702Auth,
      };
    },
  };
}
