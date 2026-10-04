import { z } from "zod";
import type { RothConversionPageOptions } from "./types";

// `.default()` on purpose: the export route passes RAW options to
// `requiredScenarioRefs`/`requiredDerivedRefs` while `document.tsx` passes
// `{...defaultOptions, ...options}`. A field that parses to `undefined` on one
// side builds a different bundle key from the other, and the page silently
// prints its empty state.
export const rothConversionOptionsSchema = z.object({
  scenarioId: z.string().default("base"),
}) satisfies z.ZodType<RothConversionPageOptions>;
