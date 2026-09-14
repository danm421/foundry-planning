import { holdingsReconciliation, materiallyUndershoots } from "@/lib/extraction/normalize-holdings";
import { livingHoldings } from "@/lib/imports/living-rows";
import type { ExtractedAccount } from "@/lib/extraction/types";

/** Whole dollars, matching every other money figure on this table. */
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The count of positions inside one account, paired with what they add up to
 * against the account's stated value.
 *
 * The pairing is the point. Holdings extraction stops early on long tables —
 * a prod account produced 33 positions of a $2,727,270 statement, covering
 * the muni ladder and equities A through AM, then stopping dead. The
 * continuation loop in `holdings-completion.ts` mitigates that but can still
 * give up, and a bare "33" reads exactly like a complete answer. The
 * reconciliation is the only figure on this screen that can tell them apart.
 */
export function HoldingsCell({ row }: { row: Pick<ExtractedAccount, "value" | "holdings"> }) {
  const living = livingHoldings(row);
  if (living.length === 0) return <>—</>;

  const { sum, total, gap, flagged } = holdingsReconciliation(living, row.value);
  const short = materiallyUndershoots({ flagged, gap });
  // `holdingsReconciliation` defaults a missing stated value to 0 (and then
  // suppresses `flagged` on `total > 0`, so nothing warns). Printing that
  // default reads as "$604,756 of $0" — a reconciliation catastrophe rather
  // than the missing input it is. There is nothing to reconcile against, so
  // this says so instead of naming a number the statement never gave.
  const hasStatedValue = row.value != null;

  return (
    <span className="flex flex-col items-end">
      <span>
        <span className="tabular">{living.length}</span>{" "}
        {living.length === 1 ? "holding" : "holdings"}
      </span>
      <span className={`text-xs ${flagged ? "text-warn" : "text-ink-3"}`}>
        <span className="tabular">{money(sum)}</span>
        {hasStatedValue ? (
          <>
            {" of "}
            <span className="tabular">{money(total)}</span>
            {short ? " · short" : flagged ? " · over" : ""}
          </>
        ) : (
          " · no stated total"
        )}
      </span>
    </span>
  );
}
