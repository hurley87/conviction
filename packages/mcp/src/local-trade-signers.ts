// Local ethers TradeSigners for Particle rootHash + EIP-7702 (ADR 0045).
// Same TradeSigners boundary as the Privy-backed browser integration.

import { getBytes } from "ethers";

import type { LocalWallet } from "./keystore.js";

/** Shared signing boundary with the web app TradeSigners contract. */
export type TradeSigners = {
  signRootHash: (rootHash: string) => Promise<string>;
  sign7702: (auth: {
    contractAddress: string;
    chainId: number;
    nonce: number;
  }) => Promise<string>;
};

/**
 * Build Particle-compatible signers from a locally held ethers wallet.
 * Root hashes are signed as EIP-191 over decoded bytes (never hex text).
 * EIP-7702 authorizations use wallet.authorize and return the serialized sig.
 */
export function createLocalTradeSigners(wallet: LocalWallet): TradeSigners {
  return {
    async signRootHash(rootHash: string): Promise<string> {
      if (typeof rootHash !== "string" || !rootHash.startsWith("0x")) {
        throw new Error("rootHash must be a 0x-prefixed hex digest.");
      }
      return wallet.signMessage(getBytes(rootHash));
    },

    async sign7702(auth: {
      contractAddress: string;
      chainId: number;
      nonce: number;
    }): Promise<string> {
      if (
        typeof auth.contractAddress !== "string" ||
        !auth.contractAddress.startsWith("0x")
      ) {
        throw new Error("contractAddress must be a 0x-prefixed address.");
      }
      if (!Number.isInteger(auth.chainId) || auth.chainId < 0) {
        throw new Error("chainId must be a non-negative integer.");
      }
      if (!Number.isInteger(auth.nonce) || auth.nonce < 0) {
        throw new Error("nonce must be a non-negative integer.");
      }

      const authorization = await wallet.authorize({
        address: auth.contractAddress,
        chainId: auth.chainId,
        nonce: auth.nonce,
      });
      return authorization.signature.serialized;
    },
  };
}
