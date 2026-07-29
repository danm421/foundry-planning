// src/lib/household-map/format.ts
import { formatCurrency } from "@/lib/cell-drill/format";

/** "$160,000" / "($10,000)" — negatives in accounting parens, per MapItem. */
export function moneyLabel(value: number): string {
  if (value < 0) return `(${formatCurrency(-value)})`;
  // Negating a zero balance yields `-0`, which Intl renders as "-$0".
  return formatCurrency(value === 0 ? 0 : value);
}
