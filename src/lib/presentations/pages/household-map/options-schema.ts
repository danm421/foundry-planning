import { z } from "zod";
import type { HouseholdMapPageOptions } from "./types";

// No per-instance options — an empty object keeps the registry plumbing
// (defaultOptions / optionsSchema / summarizeOptions) uniform with the rest.
// The only control on these pages is the shared scenario picker.
export const householdMapOptionsSchema = z.object(
  {},
) satisfies z.ZodType<HouseholdMapPageOptions>;
