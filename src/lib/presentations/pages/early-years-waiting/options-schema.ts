import { z } from "zod";
import type { EarlyYearsWaitingPageOptions } from "./types";

// Every field carries a `.default()` on purpose. The export route passes RAW
// page options to `requiredDerivedRefs`/`requiredScenarioRefs` while
// `document.tsx` passes `{...defaultOptions, ...options}`; a field that parses
// to `undefined` on one side and a value on the other makes the two build
// different keys, and the page silently renders its empty state.
export const earlyYearsWaitingOptionsSchema = z.object({
  rungOffset: z.number().min(0).max(1).default(0.03),
  // Capped at four arms: each one costs a full extra projection at export time,
  // and a fifth bar per cluster stops being readable on a half-width chart
  // beside the tidbit sidebar.
  delays: z.array(z.number().int().min(0).max(40)).min(1).max(4).default([0, 5, 10]),
  milestoneAges: z.array(z.number().int().min(1).max(120)).min(1).max(4).default([40, 50, 65]),
  tidbits: z.array(z.string()).max(2).default([]),
}) satisfies z.ZodType<EarlyYearsWaitingPageOptions>;
