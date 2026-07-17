export function shouldForceOnboarding({
  live,
  authReady,
  authenticated,
  profileReady,
  needsOnboarding,
}: {
  live: boolean;
  authReady: boolean;
  authenticated: boolean;
  profileReady: boolean;
  needsOnboarding: boolean;
}) {
  return (
    live &&
    authReady &&
    authenticated &&
    profileReady &&
    needsOnboarding
  );
}
