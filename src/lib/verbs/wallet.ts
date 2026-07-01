// EIP-7702 delegation detection. A delegated EOA carries code of the form
// 0xef0100 || <20-byte implementation address> (EIP-7702). We use this to tell
// whether the account is already "upgraded" instead of trusting ephemeral UI
// state (ADR 0004).

/** The EIP-7702 delegation designator prefix in an account's code. */
const DELEGATION_PREFIX = "0xef0100";

/** True when an account's `eth_getCode` result shows a 7702 delegation. */
export function isDelegated(code: string | null | undefined): boolean {
  return (
    typeof code === "string" &&
    code.toLowerCase().startsWith(DELEGATION_PREFIX)
  );
}
