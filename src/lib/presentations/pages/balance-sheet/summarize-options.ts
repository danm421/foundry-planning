import type { BalanceSheetOptions } from "./options-schema";

export function summarizeBalanceSheetOptions(o: BalanceSheetOptions): string {
  return o.asOf === "today" ? "As of today" : `End of ${o.year}`;
}
