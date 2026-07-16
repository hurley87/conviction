// Shared conviction card anatomy — why-now / what-breaks-it / gate report
// (issue #18 / ADR 0016). Used by the feed card and the home deck.

import { formatTimestamp } from "@/lib/format";
import { hasAnatomy } from "@/lib/verbs/conviction";
import type { ConvictionEntry, GateCheck, WhyNowEvent } from "@/lib/verbs/types";

function WhyNowList({ events }: { events: WhyNowEvent[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {events.map((e) => (
        <li key={`${e.at}-${e.event}`} className="text-xs leading-relaxed text-ink-2">
          <time className="font-bold text-ink" dateTime={e.at}>
            {formatTimestamp(e.at)}
          </time>
          <span className="text-ink-4"> — </span>
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
          key={c.id ?? c.name}
          className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2"
        >
          <span
            className={
              c.passed
                ? "font-bold text-success"
                : "font-bold text-danger"
            }
          >
            {c.passed ? "Pass" : "Fail"}
          </span>
          <span>{!c.passed && c.detail ? c.detail : c.name}</span>
          {c.evidenceUrl && (
            <a
              href={c.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-brand hover:underline"
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
      className="mt-4 rounded-[18px] border border-line bg-surface-2/75 px-3 py-2"
      open={defaultOpen || undefined}
    >
      <summary className="cursor-pointer text-xs font-bold text-ink-3 select-none">
        Card details
      </summary>
      <div className="mt-3 grid gap-2.5 border-t border-line pt-3">
        {entry.whyNow && entry.whyNow.length > 0 && (
          <section className="rounded-[14px] bg-surface/70 p-3">
            <h3 className="text-[10px] font-extrabold tracking-[0.12em] text-warning uppercase">
              Why now
            </h3>
            <WhyNowList events={entry.whyNow} />
          </section>
        )}
        {entry.whatBreaksIt && (
          <section className="rounded-[14px] bg-surface/70 p-3">
            <h3 className="text-[10px] font-extrabold tracking-[0.12em] text-brand uppercase">
              What breaks it
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              {entry.whatBreaksIt}
            </p>
          </section>
        )}
        {entry.gateReport && entry.gateReport.length > 0 && (
          <section className="rounded-[14px] bg-surface/70 p-3">
            <h3 className="text-[10px] font-extrabold tracking-[0.12em] text-success uppercase">
              Gate report
            </h3>
            <GateReportList checks={entry.gateReport} />
          </section>
        )}
      </div>
    </details>
  );
}
