# Gas is paid via UA abstraction, with invisible dust pre-funding as fallback

The user is shielded from gas by relying on **Universal Accounts' native gas abstraction** — fees are drawn from the unified balance (e.g. USDC), with no separate native gas token required. If UA still needs a minimum native balance to submit the 7702 authorization itself, onboarding **invisibly pre-funds a tiny dust amount** of native gas onto the EOA as a fallback. The main UI never says "gas"; the receipt surface may disclose the fee.

We rejected building a **paymaster / sponsored-gas** contract: too much engineering and funding for a hackathon, and unnecessary if UA's gas abstraction works. This became a live requirement once ADR 0001 moved the demo to mainnet, where gas is real and a zero-native-token social-login user would otherwise fail at their first trade.

## Status
Depends on an unconfirmed Particle capability. **Gating question: confirm UA pays gas from the unified balance with no native token required.** If false, the dust-funding fallback is the guaranteed path.
