"use client";

import {
  SETUP_CONTRACT,
  type SetupPhase,
} from "@conviction/mcp/setup-contract";

export function SetupProgressRail({ phase }: { phase: SetupPhase }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SETUP_CONTRACT.steps.map((step, index) => {
        const isComplete = phase.completedStepIds.includes(step.id);
        const isCurrent = step.id === phase.currentStep;
        return (
          <li
            key={step.id}
            className={`rounded-[18px] border px-4 py-3 ${
              isCurrent
                ? "border-brand/30 bg-brand-soft/50"
                : isComplete
                  ? "border-line bg-surface-2"
                  : "border-line/70 bg-white/40"
            }`}
          >
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-3">
              Step {index + 1}
              {isCurrent ? " · current" : isComplete ? " · done" : ""}
            </p>
            <p className="mt-1 text-sm font-extrabold text-ink">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-ink-2">{step.summary}</p>
          </li>
        );
      })}
    </ol>
  );
}
