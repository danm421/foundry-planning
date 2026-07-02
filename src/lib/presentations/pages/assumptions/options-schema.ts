import { z } from "zod";

export const assumptionsOptionsSchema = z.object({
  includeAccountTable: z.boolean().default(true),
  includeCmaAppendix: z.boolean().default(true),
  showAccountValues: z.boolean().default(true),
});

export type AssumptionsPageOptions = z.infer<typeof assumptionsOptionsSchema>;

export const ASSUMPTIONS_OPTIONS_DEFAULT: AssumptionsPageOptions = {
  includeAccountTable: true,
  includeCmaAppendix: true,
  showAccountValues: true,
};
