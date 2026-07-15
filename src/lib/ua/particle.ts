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
  buildConvertPayload,
  defaultTradeConfig,
  isSellIntent,
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
  warmUpToken(token: {
    chainId: number;
    address: string;
  }): Promise<{ router?: unknown | null } | null>;
  getTokenPair(token: {
    chainId: number;
    address: string;
  }): Promise<{ pair?: { address: string; factory: string } } | null>;
  createBuyTransaction(
    payload: { token: { chainId: number; address: string }; amountInUSD: string },
    tradeConfig?: Record<string, unknown>,
  ): Promise<RawTransaction>;
  createConvertTransaction(
    payload: { chainId: number; expectToken: { type: string; amount: string } },
    tradeConfig?: Record<string, unknown>,
  ): Promise<RawTransaction>;
  sendTransaction(
    transaction: RawTransaction,
    signature: string,
    authorizations?: { userOpHash: string; signature: string }[],
  ): Promise<{ transactionId?: string }>;
};

const WARM_UP_POLLS = 4;
const WARM_UP_POLL_MS = 3000;

const NO_ROUTE_MESSAGE =
  "This token has no route through your Universal Account yet, so it can't be bought here.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createParticleUAClient(config: ParticleConfig): UAClient {
  let accountPromise: Promise<unknown> | null = null;

  async function sdk() {
    return import("@particle-network/universal-account-sdk");
  }

  async function account(): Promise<ParticleAccount> {
    if (!accountPromise) {
      accountPromise = (async () => {
        const { UniversalAccount, UNIVERSAL_ACCOUNT_VERSION_V2 } = await sdk();
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
        });
      })();
    }
    return accountPromise as Promise<ParticleAccount>;
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

  /** UniversalX-style route warm-up for tokens outside the primary set:
   * warmUpToken registers the route, getTokenPair yields the DEX pair the
   * buy must be quoted against. A null router means Particle can't route
   * this token (true for ALL non-primaries on Arbitrum as of 2026-07). */
  async function warmUpTokenPair(
    ua: ParticleAccount,
    token: { chainId: number; address: string },
  ): Promise<{ address: string; factory: string }> {
    const warm = await ua.warmUpToken(token);
    if (!warm?.router) {
      throw new Error(NO_ROUTE_MESSAGE);
    }
    for (let attempt = 0; attempt < WARM_UP_POLLS; attempt++) {
      const pair = (await ua.getTokenPair(token))?.pair;
      if (pair?.address) {
        return { address: pair.address, factory: pair.factory };
      }
      await sleep(WARM_UP_POLL_MS);
    }
    throw new Error(NO_ROUTE_MESSAGE);
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
          toAsset: freshQuote.toAsset,
          receivedSymbol: freshQuote.receivedSymbol,
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
      };
    },
  };
}
