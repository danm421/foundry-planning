// src/lib/tax/state-income/data/ss-rules.ts
// Hand-encoded from the Social_Security sheet of State_Income_Tax_Engine_2026.xlsx.
// Only non-exempt states are listed. The default for any unlisted state is { kind: "exempt" }.
//
// Phase-1 semantic for "conditional": cliff rule — AGI below threshold → fully exempt;
// AGI at/above threshold → SS income is taxed at the state's normal marginal rates.
// Notes fields call out where real law is more nuanced (phase-outs, age carve-outs, etc.)
// for future refinement in C2+.
import type { USPSStateCode } from "@/lib/usps-states";
import type { SsTreatment } from "../types";

// ---------------------------------------------------------------------------
// 2026 rules — current-year source of truth
// ---------------------------------------------------------------------------

export const SS_RULES_2026: Partial<Record<USPSStateCode, SsTreatment>> = {
  // ── Fully taxed states ─────────────────────────────────────────────────

  // Montana: conforms to federal rules with a $5,500+ deduction for 65+ that
  // may partially or fully offset SS, but the base treatment is federal-conformant.
  MT: {
    kind: "taxed",
  },

  // Utah: SS included in income per federal rules; a retirement tax credit
  // (up to $450 per filer) partially offsets — modeled as taxed here; credit
  // handled separately in the retirement-credit layer.
  UT: {
    kind: "taxed",
  },

  // ── Conditional states (cliff unless noted) ───────────────────────────

  // Colorado — Age 65+: fully exempt regardless of AGI.
  // Age 55–64: fully exempt if AGI < threshold; otherwise capped $20K deduction applies.
  // Phase-1 models the 55–64 range as a cliff; 65+ unconditional exemption modeled
  // via ageFullExemption.
  CO: {
    kind: "conditional",
    singleAgiThreshold: 75_000,
    jointAgiThreshold: 95_000,
    ageFullExemption: 65,
    notes:
      "Age 65+: full exemption regardless of AGI. Age 55–64: cliff at threshold (real law: $20K deduction above threshold — flag for phase-2 refinement).",
  },

  // Connecticut — 100% exempt below threshold; 25% of SS taxable above threshold.
  // Phase-1 simplifies to a cliff (fully taxed above threshold).
  CT: {
    kind: "conditional",
    singleAgiThreshold: 75_000,
    jointAgiThreshold: 100_000,
    notes:
      "Real law: 25% of SS taxable above threshold (not 100%). Phase-1 models as cliff; phase-2 should apply 25% inclusion rate.",
  },

  // Minnesota — Deduction phases out 20¢ per $1 of provisional income over
  // threshold; fully taxed above phase-out. Phase-1 treats as a cliff at
  // threshold. 2025 provisional-income thresholds (indexed annually).
  MN: {
    kind: "conditional",
    singleAgiThreshold: 84_490,
    jointAgiThreshold: 108_320,
    notes:
      "Phase-out (not cliff): deduction reduces 20¢/$1 above threshold; provisional income = Fed AGI − taxable SS + 50% SS + tax-free interest. Phase-2 should implement the phase-out formula.",
  },

  // New Mexico — Cliff: fully exempt at/below threshold, fully taxed above.
  // Thresholds: single $100K, MFJ $150K, MFS $75K. Using $75K for single
  // (conservative; MFS filers filing single in the engine).
  NM: {
    kind: "conditional",
    singleAgiThreshold: 100_000,
    jointAgiThreshold: 150_000,
    notes:
      "MFS threshold is $75K (not modeled separately in phase-1). Added 2022; thresholds raised since.",
  },

  // Rhode Island — Cliff, FRA-based. Filer must have reached Full Retirement
  // Age AND AGI must be below threshold for exemption. Phase-1 ignores the
  // FRA check (conservative assumption: applies if AGI < threshold).
  RI: {
    kind: "conditional",
    singleAgiThreshold: 88_950,
    jointAgiThreshold: 111_200,
    notes:
      "FRA requirement not modeled in phase-1 — engine applies exemption to any filer below threshold. Flag for phase-2 FRA-gate.",
  },

  // Vermont — Full exemption below threshold; linear phase-out over next $10K;
  // zero exemption above ($65K single / $80K joint). Phase-1 models as cliff
  // at the lower threshold.
  VT: {
    kind: "conditional",
    singleAgiThreshold: 55_000,
    jointAgiThreshold: 70_000,
    notes:
      "Real law: linear phase-out $55K–$65K single / $70K–$80K joint. Phase-1 uses cliff at lower bound; phase-2 should implement the pro-rata phase-out.",
  },
};

// ---------------------------------------------------------------------------
// 2025 rules — only entries that DIFFER from 2026 belong here
// ---------------------------------------------------------------------------

export const SS_RULES_2025: Partial<Record<USPSStateCode, SsTreatment>> = {
  // Kansas — had a $75K AGI limit through 2023; became fully exempt in 2024.
  // No diff needed for 2025 vs 2026 (both fully exempt → no entry).

  // Missouri — income caps removed 2024; fully exempt 2024+.
  // No diff needed for 2025 vs 2026.

  // Nebraska — SS fully exempt starting 2025 per LB 873.
  // No diff needed for 2025 vs 2026 (both exempt).

  // West Virginia — 65% exempt in 2025, 100% in 2026.
  // Phase-1 cliff: treat as fully taxed in 2025 (conservative — real rule is
  // 65% deduction, which the engine can't express yet without a pct-exempt kind).
  WV: {
    kind: "taxed",
  },
};

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

/** Returns the SS treatment for a given state and tax year.
 *  Falls back to 2026 rules when no 2025 override exists.
 *  Unlisted states default to { kind: "exempt" }. */
export function getSsRule(state: USPSStateCode, year: number): SsTreatment {
  const set = year >= 2026 ? SS_RULES_2026 : SS_RULES_2025;
  return set[state] ?? SS_RULES_2026[state] ?? { kind: "exempt" };
}
