import type { BalanceSheetOptions } from "./options-schema";

export function summarizeBalanceSheetOptions(o: BalanceSheetOptions): string {
  const base = o.asOf === "today" ? "As of today" : `End of ${o.year}`;
  return o.includeOutOfEstate ? `${base} · with Out of Estate` : base;
}
