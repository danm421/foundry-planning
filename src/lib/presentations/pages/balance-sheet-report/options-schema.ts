import { z } from "zod";
import { balanceSheetOptionsSchema } from "../balance-sheet/options-schema";

/** The report's two tabs: the household by owner, or a card per trust and business. */
export const BALANCE_SHEET_REPORT_VIEWS = { household: "Household", entities: "By Entity" } as const;

export const balanceSheetReportOptionsSchema = balanceSheetOptionsSchema.pick({ asOf: true, year: true }).extend({
  view: z.enum(["household", "entities"]).default("household"),
});

export type BalanceSheetReportOptions = z.infer<typeof balanceSheetReportOptionsSchema>;

// `year` is only read in `eoy` mode, and buildData clamps it into the plan.
export const BALANCE_SHEET_REPORT_OPTIONS_DEFAULT: BalanceSheetReportOptions = {
  asOf: "today",
  year: new Date().getFullYear(),
  view: "household",
};

export function summarizeBalanceSheetReportOptions(o: BalanceSheetReportOptions): string {
  return `${BALANCE_SHEET_REPORT_VIEWS[o.view]} · ${o.asOf === "today" ? "As of today" : `End of ${o.year}`}`;
}
