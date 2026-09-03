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

/**
 * Resolves a possibly-raw, possibly-legacy options blob into a complete
 * `ObservationsPageOptions`, for read sites downstream of the launcher's own
 * state rather than an export request body.
 *
 * ⚠️⚠️ Stored options are validated on WRITE only: `render-presentation-pdf.ts`'s
 * `BodySchema` re-parses every page's options against its own `optionsSchema`
 * at export time, but nothing runs `observationsPageOptionsSchema` on the way
 * back OUT. The localStorage draft restores raw (`use-launcher-draft.ts`'s
 * `readDraft` never calls `optionsSchema`), a loaded template's `options` is
 * copied verbatim (`use-launcher-state.ts`'s `loadTemplate` reducer), and the
 * launcher row hands that same object to both `summarizeOptions` and
 * `OptionsControl` untouched (`selected-page-row.tsx`, `props.options as
 * never`). So a deck saved before this task shipped still carries
 * `{ include: "both" | "observations" | "nextSteps", … }` with neither
 * boolean, and reading `.showObservations`/`.showNextSteps` off it directly
 * is `undefined` — the Generate guard would refuse a deck that used to print
 * fine, the row summary would read "Nothing selected", and the checkboxes
 * below would render uncontrolled.
 *
 * Same shape of problem, same fix, as Plan Story's `chapterStyle` gap:
 * `src/components/presentations/pages/plan-story/options-control.tsx`'s
 * "RESOLVED rather than read straight off value" comment. Resolved AT THE
 * READ SITE, not by normalizing every restored blob at ingress — ingress
 * normalization would run every page's own schema over every restored blob, a
 * behaviour change to shared launcher infrastructure well outside this page.
 *
 * Reuses `observationsPageOptionsSchema` itself (which already carries the
 * legacy `include` migration) rather than a second hand-written mapping —
 * `safeParse` so a genuinely foreign blob falls back to the page's default
 * instead of throwing mid-render.
 */
export function resolveObservationsPageOptions(raw: unknown): ObservationsPageOptions {
  const parsed = observationsPageOptionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : OBSERVATIONS_PAGE_OPTIONS_DEFAULT;
}

/** Both halves off is a sheet with nothing on it; the launcher's Generate
 *  guard blocks the export rather than printing it. Takes `unknown` (not
 *  `ObservationsPageOptions`) because the launcher passes it the deck's raw,
 *  possibly-legacy, possibly-unparsed page options — see
 *  `resolveObservationsPageOptions` above. */
export function isObservationsPageUnconfigured(o: unknown): boolean {
  const resolved = resolveObservationsPageOptions(o);
  return !resolved.showObservations && !resolved.showNextSteps;
}
