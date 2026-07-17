export type AccountGateInput = {
  ready: boolean;
  authenticated: boolean;
  profileReady: boolean;
  profileError: string | null;
  needsOnboarding: boolean;
};

/**
 * Shared auth/profile ladder for app chrome and onboarding.
 * - app: unfinished profiles redirect to /onboarding
 * - onboarding: unfinished and completed profiles both render the tour
 */
export type AccountGateStatus =
  | "loading"
  | "signedOut"
  | "profileError"
  | "redirectOnboarding"
  | "ready";

export function resolveAccountGate(
  account: AccountGateInput,
  mode: "app" | "onboarding",
  live: boolean,
): AccountGateStatus {
  if (!account.ready) return "loading";
  if (!account.authenticated) return "signedOut";
  if (account.profileError) return "profileError";
  if (!account.profileReady) return "loading";
  if (
    mode === "app" &&
    live &&
    account.needsOnboarding
  ) {
    return "redirectOnboarding";
  }
  return "ready";
}
