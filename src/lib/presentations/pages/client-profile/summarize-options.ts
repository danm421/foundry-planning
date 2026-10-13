import { resolveClientProfileOptions } from "./options-schema";
import { expenseColumnLabel } from "./types";

// Takes `unknown`: the launcher row passes the deck's raw, possibly-legacy options.
export function summarizeClientProfileOptions(raw: unknown): string {
  const { expenseColumns } = resolveClientProfileOptions(raw);
  return `Household snapshot · expenses: ${expenseColumns.map(expenseColumnLabel).join(", ")}`;
}
