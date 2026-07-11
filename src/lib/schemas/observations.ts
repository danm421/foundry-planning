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

export const observationCreateSchema = z.object({
  section: z.enum(["observation", "next_step"]),
  source: z.enum(["manual", "ai"]).default("manual"),
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
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
});

export type ObservationCreateInput = z.infer<typeof observationCreateSchema>;
export type ObservationUpdateInput = z.infer<typeof observationUpdateSchema>;
export type ObservationReorderInput = z.infer<typeof observationReorderSchema>;
