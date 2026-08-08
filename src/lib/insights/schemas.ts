// src/lib/insights/schemas.ts
//
// The structured-output contract for the client 360. The model RANKS and
// NARRATES the deterministic signal list it is handed; it never authors a
// finding. `signalId` is the leash: an action that cites an id no rule
// produced is dropped by `dropUncitedActions` before anything is persisted.
import { z } from "zod";

export const InsightActionSchema = z.object({
  /** MUST be one of the signal ids supplied in the prompt. */
  signalId: z.string(),
  recommendation: z.string(),
  why: z.string(),
});

export const GeneratedInsightsSchema = z.object({
  headline: z.string(),
  snapshot: z.string(),
  goals: z.string(),
  actions: z.array(InsightActionSchema),
  talkingPoints: z.array(z.string()),
});

export type InsightAction = z.infer<typeof InsightActionSchema>;
export type GeneratedInsights = z.infer<typeof GeneratedInsightsSchema>;
