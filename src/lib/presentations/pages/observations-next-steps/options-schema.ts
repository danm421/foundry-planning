// src/lib/presentations/pages/observations-next-steps/options-schema.ts
import { z } from "zod";

export interface ObservationsPageOptions {
  include: "both" | "observations" | "nextSteps";
  /** Topic slugs (see OBSERVATION_TOPICS). Empty = all topics. */
  topics: string[];
  /** When false (default), "done" next steps are dropped from the page. */
  includeCompleted: boolean;
  showOwnerAndDate: boolean;
  /** Markdown, may contain {{token}} placeholders. */
  intro: string;
}

export const observationsPageOptionsSchema = z.object({
  include: z.enum(["both", "observations", "nextSteps"]).default("both"),
  topics: z.array(z.string()).default([]),
  includeCompleted: z.boolean().default(false),
  showOwnerAndDate: z.boolean().default(true),
  intro: z.string().default(""),
}) satisfies z.ZodType<ObservationsPageOptions>;

export const OBSERVATIONS_PAGE_OPTIONS_DEFAULT: ObservationsPageOptions = {
  include: "both",
  topics: [],
  includeCompleted: false,
  showOwnerAndDate: true,
  intro: "",
};
