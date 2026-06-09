// src/lib/tax-ledger/build-diagnostics.ts
import type { ProjectionYear } from "@/engine/types";
import type { FilingStatus } from "@/lib/tax/types";
import type { TaxLedgerDiagnostics } from "./types";

const EMPTY: TaxLedgerDiagnostics = {
  agi: 0, taxableIncome: 0, totalFederalTax: 0, totalStateTax: 0, totalTax: 0,
  effectiveRate: 0, marginalRate: 0, bracketHeadroom: null,
  niit: { active: false, base: 0, thresholdDistance: null },
  irmaa: { tier: null, headroomToNextTier: null },
  amt: { bound: false, additional: 0 },
  ssTaxablePercent: null,
  taxByType: { federalOrdinary: 0, capitalGains: 0, niit: 0, ficaMedicare: 0, amt: 0, earlyWithdrawalPenalty: 0, state: 0 },
};

function niitThresholdKey(fs: FilingStatus): "mfj" | "single" | "mfs" {
  if (fs === "married_joint") return "mfj";
  if (fs === "married_separate") return "mfs";
  return "single";
}

export function buildDiagnostics(year: ProjectionYear, filingStatus: FilingStatus): TaxLedgerDiagnostics {
  const tr = year.taxResult;
  if (!tr) return EMPTY;
  const { flow, diag } = tr;

  // Bracket headroom from the marginal tier ceiling.
  const tier = diag.marginalBracketTier;
  const bracketHeadroom = tier && tier.to != null ? Math.max(0, tier.to - flow.incomeTaxBase) : null;

  // NIIT: base = tax / rate; threshold distance vs (approx) MAGI = AGI.
  const niitRate = diag.bracketsUsed.niitRate;
  const niitActive = flow.niit > 0;
  const niitBase = niitActive && niitRate > 0 ? flow.niit / niitRate : 0;
  const threshold = diag.bracketsUsed.niitThreshold[niitThresholdKey(filingStatus)];
  const thresholdDistance = threshold - flow.adjustedGrossIncome;

  // IRMAA: report the higher of the two members' tiers.
  const members = [year.medicare?.client, year.medicare?.spouse].filter(Boolean) as Array<{ irmaaTier: number; headroomToNextTier: number }>;
  const top = members.sort((a, b) => b.irmaaTier - a.irmaaTier)[0];

  // SS taxable percent.
  const ss = year.income.socialSecurity;
  const ssTaxablePercent = ss > 0 ? (tr.income.taxableSocialSecurity ?? 0) / ss : null;

  return {
    agi: flow.adjustedGrossIncome,
    taxableIncome: flow.taxableIncome,
    totalFederalTax: flow.totalFederalTax,
    totalStateTax: flow.stateTax,
    totalTax: flow.totalTax,
    effectiveRate: diag.effectiveFederalRate,
    marginalRate: diag.marginalFederalRate,
    bracketHeadroom,
    niit: { active: niitActive, base: niitBase, thresholdDistance },
    irmaa: { tier: top?.irmaaTier ?? null, headroomToNextTier: top?.headroomToNextTier ?? null },
    amt: { bound: flow.amtAdditional > 0, additional: flow.amtAdditional },
    ssTaxablePercent,
    taxByType: {
      federalOrdinary: flow.regularFederalIncomeTax,
      capitalGains: flow.capitalGainsTax,
      niit: flow.niit,
      ficaMedicare: flow.fica + flow.additionalMedicare,
      amt: flow.amtAdditional,
      earlyWithdrawalPenalty: flow.earlyWithdrawalPenalty,
      state: flow.stateTax,
    },
  };
}
