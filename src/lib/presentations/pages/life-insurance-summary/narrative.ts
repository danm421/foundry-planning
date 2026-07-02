// src/lib/presentations/pages/life-insurance-summary/narrative.ts
import { fmtUsd } from "./aggregate";
import type { DecedentGap } from "./view-model";

const MAX_LINES = 4;

export interface NarrativeInput {
  totalDeathBenefit: number;
  policyCount: number;
  clientGap: DecedentGap | null;
  spouseGap: DecedentGap | null;
  notSolved: boolean;
  jointFootnote: boolean;
}

function shortfallLine(g: DecedentGap | null): string | null {
  if (!g) return null;
  if (g.exceedsCap) return `If ${g.decedentLabel} dies, the modeled need exceeds $20M — review assumptions.`;
  if (g.gap.kind === "shortfall") {
    return `If ${g.decedentLabel} dies, coverage falls ${fmtUsd(g.gap.amount)} short of the solved need.`;
  }
  return null;
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

  const cs = shortfallLine(input.clientGap);
  if (cs) lines.push(cs);
  const ss = shortfallLine(input.spouseGap);
  if (ss) lines.push(ss);

  if (lines.length < MAX_LINES && input.jointFootnote) {
    lines.push("Joint policies are listed but excluded from per-life coverage totals.");
  }

  return lines.slice(0, MAX_LINES);
}
