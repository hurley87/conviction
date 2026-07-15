// The @particle-network/universal-account-sdk package ships type declarations
// at dist/index.d.ts but its package.json "exports" omits a "types" condition,
// so they don't resolve under moduleResolution: "bundler". We declare the
// minimal surface we use; the adapter casts to its own structural types.
declare module "@particle-network/universal-account-sdk" {
  export const UniversalAccount: new (config: unknown) => unknown;
  /** Smart-account version string the v2.0.x constructor requires ("2.0.1"). */
  export const UNIVERSAL_ACCOUNT_VERSION_V2: string;
  /** Token types plain createBuyTransaction accepts (eth/usdt/usdc/bnb/sol);
   * anything else needs the warmUpToken → getTokenPair flow. */
  export const UNIVERSAL_ACCOUNT_VERSION_V2_SUPPORTED_TOKEN_TYPES: string[];
  export function getSupportedToken(
    chainId: number,
    address: string,
  ): { type?: string } | null;
}
