"use client";

// Privy-backed signers for live trade execution (issue #2 / 7702 demo pattern).

import { useMemo } from "react";
import {
  useSign7702Authorization,
  useWallets,
  getEmbeddedConnectedWallet,
} from "@privy-io/react-auth";
import { Signature } from "ethers";
import type { TradeSigners } from "@/lib/verbs/types";

export function useLiveTradeSigners(): TradeSigners {
  const { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();
  // Use the embedded (social-login) wallet, never an injected browser
  // extension that may also be present in the wallets array.
  const wallet = getEmbeddedConnectedWallet(wallets);

  return useMemo(() => {
    if (!wallet) {
      return {
        signRootHash: async () => {
          throw new Error("No wallet connected");
        },
        sign7702: async () => {
          throw new Error("No wallet connected");
        },
      };
    }

    return {
      signRootHash: async (rootHash: string) => {
        const provider = await wallet.getEthereumProvider();
        return (await provider.request({
          method: "personal_sign",
          params: [rootHash, wallet.address],
        })) as string;
      },
      sign7702: async (auth: {
        contractAddress: string;
        chainId: number;
        nonce: number;
      }) => {
        const result = await signAuthorization(
          {
            contractAddress: auth.contractAddress as `0x${string}`,
            chainId: auth.chainId,
            nonce: auth.nonce,
          },
          { address: wallet.address },
        );
        return Signature.from({
          r: result.r,
          s: result.s,
          v: result.v ?? BigInt(result.yParity),
        }).serialized;
      },
    };
  }, [wallet, signAuthorization]);
}
