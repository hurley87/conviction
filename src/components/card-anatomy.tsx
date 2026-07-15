// Shared conviction card anatomy — why-now / what-breaks-it / gate report
// (issue #18 / ADR 0016). Used by the feed card and the home deck.

import { formatTimestamp } from "@/lib/format";
import { hasAnatomy } from "@/lib/verbs/conviction";
import type { ConvictionEntry, GateCheck, WhyNowEvent } from "@/lib/verbs/types";

function WhyNowList({ events }: { events: WhyNowEvent[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {events.map((e) => (
        <li key={`${e.at}-${e.event}`} className="text-xs text-zinc-600">
          <time className="font-medium text-zinc-800" dateTime={e.at}>
            {formatTimestamp(e.at)}
          </time>
          <span className="text-zinc-400"> — </span>
          {e.event}
        </li>
      ))}
    </ul>
  );
}

function GateReportList({ checks }: { checks: GateCheck[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {checks.map((c) => (
        <li
          key={c.name}
          className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-600"
        >
          <span
            className={
              c.passed
                ? "font-medium text-emerald-600"
                : "font-medium text-red-500"
            }
          >
            {c.passed ? "Pass" : "Fail"}
          </span>
          <span>{c.name}</span>
          {c.evidenceUrl && (
            <a
              href={c.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Evidence
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CardAnatomy({
  entry,
  defaultOpen = false,
}: {
  entry: ConvictionEntry;
  defaultOpen?: boolean;
}) {
  if (!hasAnatomy(entry)) return null;

  return (
    <details
      className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2"
      open={defaultOpen || undefined}
    >
      <summary className="cursor-pointer text-xs font-medium text-zinc-500 select-none">
        Card details
      </summary>
      <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3">
        {entry.whyNow && entry.whyNow.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              Why now
            </h3>
            <WhyNowList events={entry.whyNow} />
          </section>
        )}
        {entry.whatBreaksIt && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              What breaks it
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              {entry.whatBreaksIt}
            </p>
          </section>
        )}
        {entry.gateReport && entry.gateReport.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              Gate report
            </h3>
            <GateReportList checks={entry.gateReport} />
          </section>
        )}
      </div>
    </details>
  );
}
