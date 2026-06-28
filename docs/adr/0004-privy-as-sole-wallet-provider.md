# Privy is the sole wallet provider, for both onboarding paths

Both entry paths — "connect your existing EVM wallet" and "social login mints an embedded EOA" — go through **Privy**. Privy handles external-wallet and social-embedded login behind one SDK and exposes an EOA signer the Particle UA SDK consumes; downstream both paths are identical (get an EOA → 7702-upgrade it).

Decisive factor: **Particle's own official EIP-7702 demo signs the 7702 authorization via Privy's `useSign7702Authorization`.** Privy is therefore the reference-grade integration for the single most critical step, not just a compatible option.

We considered **Magic**, which the hackathon features and which carries a **$500 Magic Labs bonus bounty** for the no-wallet path. Rejected as the provider because it is not Particle's reference 7702 integration, so adopting it would add risk on the exact signing path that gates the whole project. The $500 bonus is not worth that risk. We also considered running a separate injected/wagmi connector for the existing-wallet path; rejected because Privy already covers it, and a second auth integration earns nothing.

## Consequences
- The Magic Labs $500 bonus bounty is deliberately forgone.
- There is exactly one auth surface and one signer-plumbing path into the UA SDK.
