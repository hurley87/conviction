// Shared display formatting. One USD formatter instance for the whole app so
// the currency spec lives in a single place.

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(n: number): string {
  return usd.format(n);
}
