// src/lib/presentations/pages/observations-next-steps/summarize-options.ts
import type { ObservationsPageOptions } from "./options-schema";

const INCLUDE_LABELS: Record<ObservationsPageOptions["include"], string> = {
  both: "Both sections",
  observations: "Observations",
  nextSteps: "Next Steps",
};

export function summarizeObservationsOptions(opts: ObservationsPageOptions): string {
  const sectionLabel = INCLUDE_LABELS[opts.include];
  const topicsLabel =
    opts.topics.length === 0
      ? "all topics"
      : opts.topics.length === 1
        ? "1 topic"
        : `${opts.topics.length} topics`;
  return `${sectionLabel} · ${topicsLabel}`;
}
