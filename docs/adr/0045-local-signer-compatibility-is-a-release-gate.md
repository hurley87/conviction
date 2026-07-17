# Local signer compatibility is a release gate

The local MCP signer uses ethers v6 for both Particle signing operations:

- Particle `rootHash` values are decoded with `getBytes(rootHash)` and signed as EIP-191 messages with `wallet.signMessage(...)`.
- EIP-7702 authorizations are signed with `wallet.authorize({ address, chainId, nonce })`, where `address` is Particle's requested delegation contract.

The resulting serialized signatures must match Particle's expected input shapes. MCP value-moving tools remain disabled in a release until the local signer passes deterministic fixed vectors, recovered-address checks, equivalence tests against the existing Privy-backed browser integration, and a manually approved tiny real-funds Particle transaction.

We rejected hand-assembling either signature because ethers provides the canonical message-byte and EIP-7702 authorization primitives. We also rejected treating compilation or mocked execution as sufficient proof because a serialization mismatch can pass local tests while making a real Universal Account unusable.

## Consequences

- The existing `TradeSigners` interface remains the shared boundary between browser and MCP signers.
- Root-hash tests prove that signing the decoded bytes, rather than the hexadecimal text characters, recovers the expected address.
- Authorization tests cover chain ID, nonce, delegation address, `r`, `s`, normalized `yParity`, and serialized signature shape.
- Browser and local signer fixtures must recover the same expected owner for equivalent signing requests.
- The manually gated smoke test performs one tiny transaction that requires any still-pending 7702 authorization and records the SDK, ethers, chain, and fixture versions.
- A dependency upgrade affecting Particle transaction shape or ethers signing re-runs the compatibility gate before publication.
