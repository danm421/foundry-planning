// src/lib/presentations/pages/observations-next-steps/options-schema.ts
import { z } from "zod";

export interface ObservationsPageOptions {
  /** The two halves of the page, each independently on or off. */
  showObservations: boolean;
  showNextSteps: boolean;
  /** Topic slugs (see OBSERVATION_TOPICS). Empty = all topics. */
  topics: string[];
  /** When false (default), "done" next steps are dropped from the page. */
  includeCompleted: boolean;
  showOwnerAndDate: boolean;
  /** Markdown, may contain {{token}} placeholders. */
  intro: string;
}

const baseSchema = z.object({
  showObservations: z.boolean().default(true),
  showNextSteps: z.boolean().default(true),
  topics: z.array(z.string()).default([]),
  includeCompleted: z.boolean().default(false),
  showOwnerAndDate: z.boolean().default(true),
  intro: z.string().default(""),
});

/**
 * Before 0256 the page had one `include: "both" | "observations" | "nextSteps"`
 * select. Every saved template and every per-browser launcher draft still
 * carries it, and stored decks are re-parsed through this schema at export
 * (`render-presentation-pdf.ts`, `BodySchema`) — a schema that rejected the old
 * shape would 400 every deck saved before today. Migrated only when the new
 * booleans are absent, so a blob that already carries them is never
 * overridden by a stale `include` riding beside them.
 */
function migrateLegacyInclude(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  if ("showObservations" in o || "showNextSteps" in o || !("include" in o)) return raw;
  const { include, ...rest } = o;
  return {
    ...rest,
    showObservations: include === "both" || include === "observations",
    showNextSteps: include === "both" || include === "nextSteps",
  };
}

export const observationsPageOptionsSchema = z.preprocess(migrateLegacyInclude, baseSchema);

export const OBSERVATIONS_PAGE_OPTIONS_DEFAULT: ObservationsPageOptions = {
  showObservations: true,
  showNextSteps: true,
  topics: [],
  includeCompleted: false,
  showOwnerAndDate: true,
  intro: "",
};

/** Both halves off is a sheet with nothing on it; the launcher's Generate
 *  guard blocks the export rather than printing it. */
export function isObservationsPageUnconfigured(o: ObservationsPageOptions): boolean {
  return !o.showObservations && !o.showNextSteps;
}
