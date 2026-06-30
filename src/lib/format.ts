// Shared display formatting. One USD formatter instance for the whole app so
// the currency spec lives in a single place.

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(n: number): string {
  return usd.format(n);
}

// Fixed locale + timezone so server and client render identically (no
// hydration mismatch). Feed timestamps are shown in UTC.
const timestamp = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatTimestamp(iso: string): string {
  return timestamp.format(new Date(iso));
}

// Short form of a blockchain address for display: 0x1234…cdef.
export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
