import type { ExtractedHolding } from "@/lib/extraction/types";
import type { ColumnSpec } from "./entity-table";

/** Named `.ts` for the same reason `accounts-columns.ts` is: a JSX-free spec
 *  list. Task 6 adds the `edit` renderers, which use `createElement`. */
export const HOLDING_COLUMNS: ColumnSpec<ExtractedHolding>[] = [
  { key: "ticker", header: "Ticker", kind: "string" },
  { key: "name", header: "Name", kind: "string" },
  { key: "shares", header: "Shares", kind: "number" },
  { key: "price", header: "Price", kind: "price" },
  { key: "marketValue", header: "Market value", kind: "money" },
  { key: "costBasis", header: "Cost basis", kind: "money" },
];
