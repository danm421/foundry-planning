import { db } from "@/db";
import { ltcPolicies, type LtcPolicyRow } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import type { LtcPolicy } from "@/engine/types";

/** decimal-as-string → number; `null` stays `null` (an unset rider percentage
 *  is not 0%). */
const num = (v: string | null): number | null => (v == null ? null : Number(v));
const numOr0 = (v: string | null): number => Number(v ?? 0);

/** Row → engine shape. Field for field: only the decimal strings change. */
export function rowToLtcPolicy(r: LtcPolicyRow): LtcPolicy {
  return {
    id: r.id,
    name: r.name,
    insured: r.insured,
    carrier: r.carrier,
    kind: r.kind,
    lifePolicyAccountId: r.lifePolicyAccountId,
    issueYear: r.issueYear,
    benefitAmount: numOr0(r.benefitAmount),
    benefitUnit: r.benefitUnit,
    riderBenefitMode: r.riderBenefitMode,
    riderMonthlyPct: num(r.riderMonthlyPct),
    benefitPeriodMode: r.benefitPeriodMode,
    benefitPeriodYears: r.benefitPeriodYears,
    riderMaxPct: num(r.riderMaxPct),
    extensionYears: r.extensionYears,
    residualDeathBenefit: numOr0(r.residualDeathBenefit),
    eliminationDays: r.eliminationDays,
    homeCarePct: numOr0(r.homeCarePct),
    inflationRider: r.inflationRider,
    inflationRate: numOr0(r.inflationRate),
    benefitType: r.benefitType,
    sharedCare: r.sharedCare,
    annualPremium: numOr0(r.annualPremium),
    premiumPayMode: r.premiumPayMode,
    premiumPayToAge: r.premiumPayToAge,
    premiumPayYears: r.premiumPayYears,
    partnership: r.partnership,
    notes: r.notes,
  };
}

/** Client-level, not scenario-scoped. Takes no firmId and trusts its caller —
 *  every caller has already checked access to `clientId`. */
export async function loadLtcPolicies(clientId: string): Promise<LtcPolicy[]> {
  const rows = await db
    .select()
    .from(ltcPolicies)
    .where(eq(ltcPolicies.clientId, clientId))
    .orderBy(asc(ltcPolicies.name));
  return rows.map(rowToLtcPolicy);
}
