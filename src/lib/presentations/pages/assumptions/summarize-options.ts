import type { AssumptionsPageOptions } from "./options-schema";

export function summarizeAssumptionsOptions(o: AssumptionsPageOptions): string {
  const parts = ["Overview"];
  if (o.includeAccountTable) parts.push("accounts");
  if (o.includeCmaAppendix) parts.push("CMA");
  return parts.join(" · ");
}
