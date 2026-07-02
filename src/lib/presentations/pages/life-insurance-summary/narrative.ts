// src/lib/presentations/pages/life-insurance-summary/narrative.ts
import { fmtUsd } from "./aggregate";
import type { DecedentRange } from "./view-model";

const MAX_LINES = 4;

export interface NarrativeInput {
  totalDeathBenefit: number;
  policyCount: number;
  clientRange: DecedentRange | null;
  spouseRange: DecedentRange | null;
  notSolved: boolean;
  jointFootnote: boolean;
}

function needLine(r: DecedentRange | null): string | null {
  if (!r) return null;
  if (r.mc.exceedsCap || r.straightLine?.exceedsCap) {
    return `If ${r.decedentLabel} dies, the modeled need exceeds $20M — review assumptions.`;
  }
  const low = r.straightLine?.need ?? r.mc.need;
  const high = r.mc.need;
  if (high <= 0) {
    return `Existing coverage of ${fmtUsd(r.existingTotal)} meets the modeled need if ${r.decedentLabel} dies in ${r.deathYear}.`;
  }
  const amount = low === high ? fmtUsd(high) : `${fmtUsd(low)}–${fmtUsd(high)}`;
  return `If ${r.decedentLabel} dies in ${r.deathYear}, an additional ${amount} of coverage is suggested on top of ${fmtUsd(r.existingTotal)} in force.`;
}

export function buildLifeInsuranceNarrative(input: NarrativeInput): string[] {
  const lines: string[] = [];

  const policyWord = input.policyCount === 1 ? "policy" : "policies";
  lines.push(
    `${input.policyCount} ${policyWord} totaling ${fmtUsd(input.totalDeathBenefit)} of death benefit.`,
  );

  if (input.notSolved) {
    lines.push("Run the life insurance solver, then regenerate to see coverage vs. need.");
    return lines.slice(0, MAX_LINES);
  }

  const cl = needLine(input.clientRange);
  if (cl) lines.push(cl);
  const sl = needLine(input.spouseRange);
  if (sl) lines.push(sl);

  if (lines.length < MAX_LINES && input.jointFootnote) {
    lines.push("Joint policies are listed but excluded from per-life coverage totals.");
  }

  return lines.slice(0, MAX_LINES);
}
