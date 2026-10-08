/**
 * The Income step's Social Security answers, worded for reading back.
 *
 * Shared by the client's own review screen, the advisor's review diff and the
 * CRM note, so all three say the same thing about the same answer.
 */

import type { IntakeSocialSecurity } from "@/lib/intake/schema";
import { personLabel } from "@/lib/owner-labels";

type Answer = IntakeSocialSecurity["client"];

/**
 * "$2,800/mo at FRA · start at 67", or either half alone. Null when the person
 * answered nothing — a $0 benefit included, since that is what an untouched
 * field reads.
 */
export function socialSecurityAnswerLabel(a: Answer): string | null {
  const parts = [
    a?.piaMonthly
      ? `$${Math.round(a.piaMonthly).toLocaleString()}/mo at ${a.benefitAge ?? "FRA"}`
      : null,
    a?.claimingAge !== undefined ? `start at ${a.claimingAge}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const line = parts.join(" · ");
  return line[0].toUpperCase() + line.slice(1);
}

type StatedRow = {
  piaMonthly: string | null;
  annualAmount: string | null;
  ssBenefitMode: string | null;
  ssStatedAge: number | null;
  ssStatedAgeMonths: number | null;
  ssAmountUnit: string | null;
  claimingAge: number | null;
  claimingAgeMonths: number | null;
  claimingAgeMode: string | null;
};

/**
 * A Social Security row as the step's answers — only what the step can show
 * exactly. Apply writes back whatever the form carries, so seeding an
 * approximation would rewrite the plan on an untouched form: a claim at
 * 66y 6mo would come back as 66, and a row claiming at FRA would be pinned to
 * a fixed age. Those read "Not sure", which apply leaves alone.
 */
export function ssAnswerFromRow(row: StatedRow): Answer {
  const pia = Number(row.piaMonthly ?? 0);
  const age = row.claimingAge;
  return {
    ...(row.ssBenefitMode === "pia_at_fra" && pia > 0 ? { piaMonthly: pia } : {}),
    // A benefit quoted at a whole age, in monthly terms, reads back as that age.
    // A yearly figure would show as a per-month one; one with no stated age is
    // priced at its own claim age. The step can show neither: "Not sure".
    ...(row.ssBenefitMode === "manual_amount" &&
    row.ssStatedAge !== null &&
    (row.ssStatedAgeMonths ?? 0) === 0 &&
    row.ssAmountUnit === "monthly" &&
    Number(row.annualAmount) > 0
      ? { piaMonthly: Number(row.annualAmount) / 12, benefitAge: row.ssStatedAge }
      : {}),
    // A NULL mode reads as "years" in the engine (`claimAge.ts`), so it counts.
    ...((row.claimingAgeMode ?? "years") === "years" &&
    (row.claimingAgeMonths ?? 0) === 0 &&
    age !== null &&
    age >= 62 &&
    age <= 70
      ? { claimingAge: age }
      : {}),
  };
}

/**
 * The benefit half of the income-row patch for an answer. A figure quoted at
 * another age is a benefit-at-age entry (the engine prices it off the PIA it
 * implies); otherwise it is the PIA at full retirement age, which also clears
 * any stated age an earlier answer left on the row.
 */
export function ssBenefitPatch(pia: number | undefined, benefitAge: number | undefined) {
  if (pia === undefined) return {};
  if (benefitAge !== undefined) {
    return {
      ssBenefitMode: "manual_amount" as const,
      annualAmount: String(pia * 12),
      piaMonthly: null,
      ssStatedAge: benefitAge,
      ssStatedAgeMonths: 0,
      ssAmountUnit: "monthly" as const,
    };
  }
  return {
    piaMonthly: String(pia),
    ssBenefitMode: "pia_at_fra" as const,
    ssStatedAge: null,
    ssStatedAgeMonths: null,
    // A monthly PIA displays monthly, even on a row that held a yearly figure.
    ssAmountUnit: "monthly" as const,
  };
}

/**
 * One entry per person who answered, client first, named the way the step
 * named them. The co-client's answer is dropped when the form has no co-client
 * — the step never showed that row, so it is the residue of a draft whose
 * spouse was removed after the fact.
 */
export function answeredSocialSecurity(
  ss: IntakeSocialSecurity | undefined,
  family:
    | { primary?: { firstName?: string }; spouse?: { firstName?: string } | null }
    | undefined,
): { owner: "client" | "spouse"; name: string; label: string }[] {
  const names = {
    clientName: family?.primary?.firstName?.trim() || "Client",
    spouseName: family?.spouse?.firstName?.trim() || null,
  };
  const out: { owner: "client" | "spouse"; name: string; label: string }[] = [];
  for (const owner of ["client", "spouse"] as const) {
    if (owner === "spouse" && !family?.spouse) continue;
    const label = socialSecurityAnswerLabel(ss?.[owner]);
    if (label !== null) out.push({ owner, name: personLabel(owner, names), label });
  }
  return out;
}
