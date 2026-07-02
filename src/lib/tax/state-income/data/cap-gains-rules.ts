// src/lib/tax/state-income/data/cap-gains-rules.ts
import type { USPSStateCode } from "@/lib/usps-states";
import type { CapGainsRule } from "../types";

export const CAP_GAINS_RULES: Partial<Record<USPSStateCode, CapGainsRule>> = {
  AR: { ltcgExemptPct: 0.5, notes: "50% LTCG exempt; gains >$10M fully exempt (not modeled)." },
  // MT does NOT statutorily exempt 30% of LTCG. Since TY2024 (SB 399) it taxes net
  // LTCG at preferential rates — 3.0% / 4.1% (§15-30-2103), stacked net of ordinary
  // income — instead of the 4.7% / 5.9% ordinary brackets. The 30% exclusion is a
  // deliberate proxy: 0.70 × 5.9% top ordinary rate ≈ 4.13% ≈ the 4.1% top
  // preferential rate. Accurate to ~0.03pp for taxpayers whose gains sit in the top
  // band (ordinary income ≥ threshold); drifts up to ~0.3pp when large gains fall in
  // the 3.0% band. Replace with a real preferential-rate schedule only if that
  // low-income-large-gain case starts to matter.
  MT: { ltcgExemptPct: 0.3, notes: "Proxy for MT preferential LTCG rates (3.0%/4.1%, §15-30-2103) — see block comment." },
  ND: { ltcgExemptPct: 0.4, notes: "40% LTCG exempt." },
  SC: { ltcgExemptPct: 0.44, notes: "44% net LTCG deduction (SC Code §12-6-1150) — broad, applies to securities." },
  WI: { ltcgExemptPct: 0.3, notes: "30% LTCG exempt." },
  // NM deliberately omitted: HB 547 repealed the broad 40% deduction effective
  // tax year 2025. Portfolio LTCG now gets only a flat $2,500 (the 40%/$1M path
  // is limited to sales of NM-based businesses), so a flat exemptPct would
  // overstate the benefit. Absent → LTCG taxed as ordinary, which is closer.
  // VT also omitted: its 40% exclusion excludes publicly-traded stocks/bonds
  // (Reg. 1.5811(21)(B)(ii)), so it does not apply to a brokerage portfolio.
  WA: {
    gainsOnly: {
      // 7% on the first $1M of taxable WA LTCG; 9.9% above (7% base + 2.9%
      // surtax added by SB 5813, effective tax year 2025+). The engine only
      // projects 2025+, so the surtax applies unconditionally.
      brackets: [
        { from: 0, to: 1_000_000, rate: 0.07 },
        { from: 1_000_000, to: null, rate: 0.099 },
      ],
    },
    notes: "WA taxes long-term capital gains only.",
  },
};
