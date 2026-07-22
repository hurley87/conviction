/**
 * Resolve the public Conviction origin for copyable CLI commands.
 * Prefer an explicit app URL, then the request origin.
 */
export function resolvePublicAppOrigin(request: Request): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const withScheme = /^https?:\/\//i.test(configured)
      ? configured
      : `https://${configured}`;
    return withScheme.replace(/\/$/, "");
  }

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) {
    return `https://${vercelHost.replace(/\/$/, "")}`;
  }

  return new URL(request.url).origin;
}
