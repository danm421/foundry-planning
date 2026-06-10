// src/lib/tax/state-income/data/cap-gains-rules.ts
import type { USPSStateCode } from "@/lib/usps-states";
import type { CapGainsRule } from "../types";

export const CAP_GAINS_RULES: Partial<Record<USPSStateCode, CapGainsRule>> = {
  AR: { ltcgExemptPct: 0.5, notes: "50% LTCG exempt; gains >$10M fully exempt (not modeled)." },
  MT: { ltcgExemptPct: 0.3, notes: "30% LTCG exempt." },
  ND: { ltcgExemptPct: 0.4, notes: "40% LTCG exempt." },
  WI: { ltcgExemptPct: 0.3, notes: "30% LTCG exempt." },
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
