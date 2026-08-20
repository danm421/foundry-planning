import { z } from "zod";
import type { EarlyYearsHumanCapitalPageOptions } from "./types";

// Every field carries a `.default()` on purpose. The export route passes RAW
// page options to `requiredDerivedRefs`/`requiredScenarioRefs` while
// `document.tsx` passes `{...defaultOptions, ...options}`; a field that parses
// to `undefined` on one side and a value on the other makes the two build
// different keys, and the page silently renders its empty state.
export const earlyYearsHumanCapitalOptionsSchema = z.object({
  tidbits: z.array(z.string()).max(2).default([]),
}) satisfies z.ZodType<EarlyYearsHumanCapitalPageOptions>;
