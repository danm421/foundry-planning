import { z } from "zod";

export const balanceSheetOptionsSchema = z.object({
  asOf: z.enum(["today", "eoy"]),
  year: z.number().int(),
  // Opt-in Out of Estate table (consolidated Balance Sheet page only). The
  // entities page shares this schema but has no out-of-estate rows to show.
  includeOutOfEstate: z.boolean().default(false),
});

export type BalanceSheetOptions = z.infer<typeof balanceSheetOptionsSchema>;

// `asOf: "today"` is the default (current snapshot); `year` is only consulted
// in `eoy` mode. The default year is the current calendar year; buildData
// clamps it into the projection range, so a stale value is harmless.
export const BALANCE_SHEET_OPTIONS_DEFAULT: BalanceSheetOptions = {
  asOf: "today",
  year: new Date().getFullYear(),
  includeOutOfEstate: false,
};
