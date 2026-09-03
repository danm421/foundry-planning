import { z } from "zod";

export const OBSERVATION_TOPICS = [
  "retirement",
  "cash-flow",
  "investments",
  "tax",
  "insurance",
  "estate",
  "education",
  "general",
] as const;

export type ObservationTopic = (typeof OBSERVATION_TOPICS)[number];

/** Shared with the advisor-facing dialog UI and the Observations presentation
 *  page's server-side view-model — kept here (not in a component) so both
 *  sides can import it without the lib layer reaching into src/components/. */
export const TOPIC_LABELS: Record<ObservationTopic, string> = {
  retirement: "Retirement",
  "cash-flow": "Cash Flow",
  investments: "Investments",
  tax: "Tax",
  insurance: "Insurance",
  estate: "Estate",
  education: "Education",
  general: "General",
};

const base = {
  topic: z.enum(OBSERVATION_TOPICS).default("general"),
  title: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1).max(8000),
  owner: z.enum(["advisor", "client", "joint"]).nullish(),
  priority: z.enum(["high", "medium", "low"]).nullish(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
};

export const OBSERVATION_AUDIENCES = ["client", "advisor"] as const;
export type ObservationAudience = (typeof OBSERVATION_AUDIENCES)[number];

export const observationCreateSchema = z.object({
  section: z.enum(["observation", "next_step"]),
  source: z.enum(["manual", "ai"]).default("manual"),
  /** Who the row is written for. Defaulted: every caller before 0256 wrote
   *  for the client, and the Details panel still does. */
  audience: z.enum(OBSERVATION_AUDIENCES).default("client"),
  /** The scenario an AI next step came from — stamped from the RUN that
   *  produced it, never from a picker's current value. */
  sourceScenarioId: z.string().uuid().nullish(),
  ...base,
});

// Written out longhand (rather than mapping over `base`) so every field's
// type is explicit — the mapped-type version fights zod's inference on
// `.optional()` over a record of mixed Zod types.
export const observationUpdateSchema = z
  .object({
    topic: z.enum(OBSERVATION_TOPICS).optional(),
    title: z.string().trim().max(200).nullish().optional(),
    body: z.string().trim().min(1).max(8000).optional(),
    owner: z.enum(["advisor", "client", "joint"]).nullish().optional(),
    priority: z.enum(["high", "medium", "low"]).nullish().optional(),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish()
      .optional(),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  })
  .strict();

export const observationReorderSchema = z.object({
  section: z.enum(["observation", "next_step"]),
  /** Scopes the "is this the whole list" check. Absent → every row in the
   *  section, the pre-0256 contract the Details panel relies on. */
  audience: z.enum(OBSERVATION_AUDIENCES).optional(),
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
});

export const observationPolishSchema = z.object({
  body: z.string().min(1).max(8000),
});

/** `DELETE /observations?section=…&source=ai` — the "Clear AI-generated"
 *  action. `source` is a literal: hand-typed rows are never bulk-deleted. */
export const observationBulkDeleteQuerySchema = z.object({
  section: z.enum(["observation", "next_step"]),
  source: z.literal("ai"),
});

/** Partial update of the per-client context row. At least one field, no
 *  unknown ones — a panel bug sending `{}` must not look like a save. */
export const observationContextPatchSchema = z
  .object({
    observationsContext: z.string().max(8000).optional(),
    nextStepsContext: z.string().max(8000).optional(),
    nextStepsScenarioId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "Nothing to update" });

/** `POST /observations/draft-runs`. `section` absent = today's both-sections
 *  draft (the Details panel); `scenario` is the pre-existing override the
 *  observation draft resolves its figures against. */
export const draftRunRequestSchema = z.object({
  section: z.enum(["observation", "next_step"]).optional(),
  scenario: z.string().min(1).optional(),
});

export type ObservationCreateInput = z.infer<typeof observationCreateSchema>;
export type ObservationUpdateInput = z.infer<typeof observationUpdateSchema>;
export type ObservationReorderInput = z.infer<typeof observationReorderSchema>;
export type ObservationPolishInput = z.infer<typeof observationPolishSchema>;
export type ObservationContextPatchInput = z.infer<typeof observationContextPatchSchema>;
export type DraftRunRequestInput = z.infer<typeof draftRunRequestSchema>;
