import { db } from "@/db";
import { disabilityPolicies, type DisabilityPolicyRow } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import type { DisabilityPolicy } from "@/engine/types";

/** decimal-as-string → number. `null` stays `null` — a null monthly max means
 *  UNCAPPED, and coercing it to 0 would silently pay nothing. */
const num = (v: string | null): number | null => (v == null ? null : Number(v));
const numOr0 = (v: string | null): number => Number(v ?? 0);

export function rowToDisabilityPolicy(r: DisabilityPolicyRow): DisabilityPolicy {
  return {
    id: r.id,
    name: r.name,
    insured: r.insured,
    coveredEarningsMode: r.coveredEarningsMode,
    coveredEarningsAmount: num(r.coveredEarningsAmount),
    shortTerm: r.hasShortTerm
      ? {
          eliminationDays: r.stdEliminationDays,
          benefitPct: numOr0(r.stdBenefitPct),
          durationWeeks: r.stdDurationWeeks,
          monthlyMax: num(r.stdMonthlyMax),
        }
      : null,
    longTerm: r.hasLongTerm
      ? {
          eliminationDays: r.ltdEliminationDays,
          benefitPct: numOr0(r.ltdBenefitPct),
          monthlyMax: num(r.ltdMonthlyMax),
          benefitPeriod: resolveBenefitPeriod(r),
        }
      : null,
    benefitTaxable: r.benefitTaxable,
    colaRate: numOr0(r.colaRate),
    annualPremium: numOr0(r.annualPremium),
    premiumPayer: r.premiumPayer,
  };
}

function resolveBenefitPeriod(r: DisabilityPolicyRow): NonNullable<
  DisabilityPolicy["longTerm"]
>["benefitPeriod"] {
  switch (r.ltdBenefitPeriodMode) {
    case "to_age":
      return { mode: "to_age", age: r.ltdBenefitPeriodAge ?? 65 };
    case "to_ssnra":
      return { mode: "to_ssnra" };
    case "years":
      return { mode: "years", years: r.ltdBenefitPeriodYears ?? 0 };
    case "lifetime":
      return { mode: "lifetime" };
  }
}

/** Client-level, not scenario-scoped — a disability policy belongs to the
 *  client (like life insurance), not to any one scenario. */
export async function loadDisabilityPolicies(clientId: string): Promise<DisabilityPolicy[]> {
  const rows = await db
    .select()
    .from(disabilityPolicies)
    .where(eq(disabilityPolicies.clientId, clientId))
    .orderBy(asc(disabilityPolicies.name));
  return rows.map(rowToDisabilityPolicy);
}
