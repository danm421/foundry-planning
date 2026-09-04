// src/lib/presentations/pages/observations-next-steps/summarize-options.ts
import { resolveObservationsPageOptions, type ObservationsPageOptions } from "./options-schema";

function sectionsLabel(opts: ObservationsPageOptions): string {
  if (opts.showObservations && opts.showNextSteps) return "Observations · Next Steps";
  if (opts.showObservations) return "Observations only";
  if (opts.showNextSteps) return "Next Steps only";
  return "Nothing selected";
}

/**
 * Takes `unknown`, not `ObservationsPageOptions` — the launcher row calls this
 * as `page.summarizeOptions(props.options as never)` with the deck's raw,
 * possibly-legacy page options (`selected-page-row.tsx`). See
 * `resolveObservationsPageOptions`'s doc comment in options-schema.ts for why
 * that blob cannot be assumed to already carry `showObservations`/
 * `showNextSteps`.
 */
export function summarizeObservationsOptions(raw: unknown): string {
  const opts = resolveObservationsPageOptions(raw);
  const topicsLabel =
    opts.topics.length === 0
      ? "all topics"
      : opts.topics.length === 1
        ? "1 topic"
        : `${opts.topics.length} topics`;
  return `${sectionsLabel(opts)} · ${topicsLabel}`;
}
