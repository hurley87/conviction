import {
  addBacker,
  saveConviction,
  listConvictions,
  listConvictionsByHandle,
} from "@/lib/convictions";
import { getReceiptEntryAt } from "@/lib/receipts";
import {
  buildConviction,
  entryPrecedesPublication,
  parseConvictionTrade,
  parseGateReport,
  parseWhatBreaksIt,
  parseWhyNow,
} from "@/lib/verbs/conviction";

function invalidPayload(field: string) {
  return Response.json({ error: `invalid ${field} payload` }, { status: 400 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle");

  const convictions = handle
    ? await listConvictionsByHandle(handle)
    : await listConvictions();

  return Response.json({ entries: convictions });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const payload = body as {
    handle?: unknown;
    thesis?: unknown;
    trade?: unknown;
    receiptSlug?: unknown;
    whyNow?: unknown;
    whatBreaksIt?: unknown;
    gateReport?: unknown;
  };

  if (typeof payload.handle !== "string" || !payload.handle.trim()) {
    return Response.json({ error: "handle required" }, { status: 400 });
  }
  if (typeof payload.thesis !== "string" || !payload.thesis.trim()) {
    return Response.json({ error: "thesis required" }, { status: 400 });
  }

  const trade = parseConvictionTrade(payload.trade);
  if (!trade) {
    return Response.json({ error: "invalid trade payload" }, { status: 400 });
  }

  const whyNow = parseWhyNow(payload.whyNow);
  if (whyNow === null) return invalidPayload("whyNow");
  const whatBreaksIt = parseWhatBreaksIt(payload.whatBreaksIt);
  if (whatBreaksIt === null) return invalidPayload("whatBreaksIt");
  const gateReport = parseGateReport(payload.gateReport);
  if (gateReport === null) return invalidPayload("gateReport");

  const receiptSlug =
    typeof payload.receiptSlug === "string" && payload.receiptSlug.trim()
      ? payload.receiptSlug.trim()
      : undefined;

  // Desk / full-anatomy cards must link an entry receipt (issue #27).
  // Plain user posts stay optional.
  const needsEntryReceipt = Boolean(
    trade.token ||
      (whyNow && whyNow.length > 0) ||
      whatBreaksIt ||
      (gateReport && gateReport.length > 0),
  );
  if (needsEntryReceipt && !receiptSlug) {
    return Response.json(
      { error: "receiptSlug required for anatomy or token cards" },
      { status: 400 },
    );
  }

  let entryAt: string | undefined;
  if (receiptSlug) {
    const found = await getReceiptEntryAt(receiptSlug);
    if (!found) {
      return Response.json({ error: "receipt not found" }, { status: 404 });
    }
    entryAt = found;
  }

  const entry = buildConviction({
    handle: payload.handle.trim(),
    thesis: payload.thesis,
    trade,
    receiptSlug,
    whyNow,
    whatBreaksIt,
    gateReport,
  });

  if (entryAt && !entryPrecedesPublication(entryAt, entry.createdAt)) {
    return Response.json(
      { error: "entry receipt timestamp must precede publication" },
      { status: 400 },
    );
  }

  const persisted = await saveConviction(entry);
  return Response.json({ entryId: entry.entryId, persisted });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const payload = body as { entryId?: unknown; handle?: unknown };

  if (typeof payload.entryId !== "string" || !payload.entryId.trim()) {
    return Response.json({ error: "entryId required" }, { status: 400 });
  }
  if (typeof payload.handle !== "string" || !payload.handle.trim()) {
    return Response.json({ error: "handle required" }, { status: 400 });
  }

  const backedBy = await addBacker(
    payload.entryId.trim(),
    payload.handle.trim(),
  );
  if (!backedBy) {
    return Response.json({ error: "conviction not found" }, { status: 404 });
  }

  return Response.json({ backedBy });
}
