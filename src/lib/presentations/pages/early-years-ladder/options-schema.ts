import { z } from "zod";
import type { EarlyYearsLadderPageOptions } from "./types";

// Every field carries a `.default()` on purpose. The export route passes RAW
// page options to `requiredDerivedRefs`/`requiredScenarioRefs` while
// `document.tsx` passes `{...defaultOptions, ...options}`; a field that parses
// to `undefined` on one side and a value on the other makes the two build
// different keys, and the page silently renders its empty state.
export const earlyYearsLadderOptionsSchema = z.object({
  // Capped at four rungs: each one costs a full extra projection at export
  // time, and a fifth cluster of bars stops being readable on a half-width
  // chart beside the tidbit sidebar.
  rungs: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("relative"), offsets: z.array(z.number()).min(1).max(4) }),
      z.object({ mode: z.literal("absolute"), percents: z.array(z.number()).min(1).max(4) }),
    ])
    .default({ mode: "relative", offsets: [0, 0.03, 0.06] }),
  milestoneAges: z.array(z.number().int().min(1).max(120)).min(1).max(4).default([40, 50, 65]),
  tidbits: z.array(z.string()).max(2).default([]),
}) satisfies z.ZodType<EarlyYearsLadderPageOptions>;
