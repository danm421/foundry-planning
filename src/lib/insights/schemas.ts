// src/lib/insights/schemas.ts
//
// The structured-output contract for the client 360. The model RANKS and
// NARRATES the deterministic signal list it is handed; it never authors a
// finding. `signalId` is the leash: an action that cites an id no rule
// produced is dropped by `dropUncitedActions` before anything is persisted.
import { z } from "zod";

// Caps follow the sibling contract in src/lib/crm/meeting-prep/schemas.ts.
// LangChain runtime-validates this schema, so a cap makes an overrunning model
// fail closed instead of persisting unbounded text into a jsonb column.
// No `.min(1)` anywhere: an empty string is a degraded profile, but a rejected
// parse loses the WHOLE generation — and an empty `signalId` is already handled
// better by `dropUncitedActions`, which drops that one action and keeps the rest.
export const InsightActionSchema = z.object({
  /** MUST be one of the signal ids supplied in the prompt. */
  signalId: z.string().max(120),
  recommendation: z.string().max(500),
  why: z.string().max(500),
});

export const GeneratedInsightsSchema = z.object({
  /** One sentence. */
  headline: z.string().max(300),
  snapshot: z.string().max(2_000),
  goals: z.string().max(2_000),
  /** Outer wall only — `dropUncitedActions` trims to MAX_ACTIONS for display. */
  actions: z.array(InsightActionSchema).max(12),
  talkingPoints: z.array(z.string().max(500)).max(12),
});

export type InsightAction = z.infer<typeof InsightActionSchema>;
export type GeneratedInsights = z.infer<typeof GeneratedInsightsSchema>;
