import { z } from "zod";
import type { EarlyYearsDebtOrInvestPageOptions } from "./types";

// Every field carries a `.default()` on purpose. The export route passes RAW
// page options to `requiredDerivedRefs`/`requiredScenarioRefs` while
// `document.tsx` passes `{...defaultOptions, ...options}`; a field that parses
// to `undefined` on one side and a value on the other makes the two build
// different keys, and the page silently renders its empty state.
export const earlyYearsDebtOrInvestOptionsSchema = z.object({
  monthlyAmount: z.number().min(0).max(100_000).default(500),
  liabilityId: z.string().nullable().default(null),
  milestoneAge: z.number().int().min(1).max(120).default(65),
  tidbits: z.array(z.string()).max(2).default([]),
}) satisfies z.ZodType<EarlyYearsDebtOrInvestPageOptions>;
