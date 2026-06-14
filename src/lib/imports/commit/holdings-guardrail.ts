import { holdingsReconciliation } from "@/lib/extraction/normalize-holdings";
import type { ExtractedHolding } from "@/lib/extraction/types";

// Pinned locale so the persisted note (and its tests) don't depend on the
// runtime's default locale.
const usd = new Intl.NumberFormat("en-US");

export interface HoldingsGuardrailResult {
  /** false → preserve the stated value (don't derive from incomplete holdings). */
  deriveFromHoldings: boolean;
  /** Persistent flag appended to account.notes, or null when no gap. */
  note: string | null;
}

/**
 * Decide whether an account should derive its value from holdings. When the
 * holdings materially undershoot the stated value (incomplete extraction, or a
 * genuine non-security asset), we keep the stated value and flag the account so
 * the advisor can reconcile — never silently understate.
 */
export function accountHoldingsGuardrail(row: {
  value?: number;
  holdings?: ExtractedHolding[];
}): HoldingsGuardrailResult {
  const holdings = row.holdings ?? [];
  if (holdings.length === 0 || row.value == null) {
    return { deriveFromHoldings: true, note: null };
  }
  const recon = holdingsReconciliation(holdings, row.value);
  if (recon.flagged && recon.gap < 0) {
    const note =
      `⚠ Holdings $${usd.format(Math.round(recon.sum))} below stated ` +
      `$${usd.format(Math.round(recon.total))} on import — value preserved, ` +
      `not derived from holdings.`;
    return { deriveFromHoldings: false, note };
  }
  return { deriveFromHoldings: true, note: null };
}
