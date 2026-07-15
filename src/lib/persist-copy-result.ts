// Shared post-trade persist for feed backs and deck backs — receipt store +
// backedBy update. Receipt POST is best-effort; PATCH must succeed.

import type { Receipt } from "@/lib/verbs/types";

export async function persistCopyResult(args: {
  receipt: Receipt;
  entryId: string;
  handle: string;
}): Promise<{ backedBy: string[] }> {
  void fetch("/api/receipts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.receipt),
  }).catch(() => {});

  const res = await fetch("/api/convictions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entryId: args.entryId, handle: args.handle }),
  });
  if (!res.ok) {
    throw new Error("Failed to record your back");
  }
  return (await res.json()) as { backedBy: string[] };
}
