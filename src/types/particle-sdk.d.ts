// The @particle-network/universal-account-sdk package ships type declarations
// at dist/index.d.ts but its package.json "exports" omits a "types" condition,
// so they don't resolve under moduleResolution: "bundler". We declare the
// minimal surface we use; the adapter casts to its own structural types.
declare module "@particle-network/universal-account-sdk" {
  export const UniversalAccount: new (config: unknown) => unknown;
}
