// src/lib/presentations/pages/observations-next-steps/summarize-options.ts
import type { ObservationsPageOptions } from "./options-schema";

function sectionsLabel(opts: ObservationsPageOptions): string {
  if (opts.showObservations && opts.showNextSteps) return "Observations · Next Steps";
  if (opts.showObservations) return "Observations only";
  if (opts.showNextSteps) return "Next Steps only";
  return "Nothing selected";
}

export function summarizeObservationsOptions(opts: ObservationsPageOptions): string {
  const topicsLabel =
    opts.topics.length === 0
      ? "all topics"
      : opts.topics.length === 1
        ? "1 topic"
        : `${opts.topics.length} topics`;
  return `${sectionsLabel(opts)} · ${topicsLabel}`;
}
