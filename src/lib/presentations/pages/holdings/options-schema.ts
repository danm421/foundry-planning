import { z } from "zod";

export const holdingsOptionsSchema = z.object({
  groupByAccount: z.boolean().default(true),
  includeCostBasis: z.boolean().default(true),
});

export type HoldingsPageOptions = z.infer<typeof holdingsOptionsSchema>;

export const HOLDINGS_OPTIONS_DEFAULT: HoldingsPageOptions = {
  groupByAccount: true,
  includeCostBasis: true,
};
