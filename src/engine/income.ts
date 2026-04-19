import type { Income, ClientInfo } from "./types";
import { resolveAnnualBenefit } from "./socialSecurity/orchestrator";

interface IncomeBreakdown {
  salaries: number;
  socialSecurity: number;
  business: number;
  trust: number;
  deferred: number;
  capitalGains: number;
  other: number;
  total: number;
  bySource: Record<string, number>;
  /** SS detail aggregated across all pia_at_fra rows this year. */
  socialSecurityDetail?: {
    client:  { retirement: number; spousal: number; survivor: number };
    spouse?: { retirement: number; spousal: number; survivor: number };
  };
}

const incomeTypeToKey: Record<Income["type"], keyof Omit<IncomeBreakdown, "total" | "bySource">> = {
  salary: "salaries",
  social_security: "socialSecurity",
  business: "business",
  trust: "trust",
  deferred: "deferred",
  capital_gains: "capitalGains",
  other: "other",
};

export function computeIncome(
  incomes: Income[],
  year: number,
  client: ClientInfo,
  filter?: (inc: Income) => boolean
): IncomeBreakdown {
  const result: IncomeBreakdown = {
    salaries: 0,
    socialSecurity: 0,
    business: 0,
    trust: 0,
    deferred: 0,
    capitalGains: 0,
    other: 0,
    total: 0,
    bySource: {},
  };

  for (const inc of incomes) {
    if (year < inc.startYear || year > inc.endYear) continue;
    if (filter && !filter(inc)) continue;

    // Social Security: delay until claiming age
    if (inc.type === "social_security" && inc.claimingAge != null) {
      const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
      if (!ownerDob) continue;
      const birthYear = parseInt(ownerDob.slice(0, 4), 10);
      const claimingYear = birthYear + inc.claimingAge;
      if (year < claimingYear) continue;

      // pia_at_fra mode → delegate to orchestrator (handles own, spousal, survivor)
      if (inc.ssBenefitMode === "pia_at_fra" && inc.piaMonthly != null) {
        // Locate the other spouse's SS row, if any, for spousal/survivor math
        const otherOwner = inc.owner === "spouse" ? "client" : "spouse";
        const spouseRow = incomes.find(
          (other) => other.id !== inc.id && other.type === "social_security" && other.owner === otherOwner,
        ) ?? null;

        const resolved = resolveAnnualBenefit({ row: inc, spouseRow, client, year });
        result.socialSecurity += resolved.total;
        result.bySource[inc.id] = resolved.total;

        // Accumulate per-spouse breakdown
        result.socialSecurityDetail ??= { client: { retirement: 0, spousal: 0, survivor: 0 } };
        const bucket = inc.owner === "spouse"
          ? (result.socialSecurityDetail.spouse ??= { retirement: 0, spousal: 0, survivor: 0 })
          : result.socialSecurityDetail.client;
        bucket.retirement += resolved.retirement;
        bucket.spousal    += resolved.spousal;
        bucket.survivor   += resolved.survivor;

        continue;
      }
    }

    let amount: number;
    if (inc.scheduleOverrides) {
      amount = inc.scheduleOverrides.get(year) ?? 0;
    } else {
      // Inflation compounds from `inflationStartYear` when set (today's-dollars
      // semantics), otherwise from the entry's own start year.
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const yearsElapsed = year - inflateFrom;
      amount = inc.annualAmount * Math.pow(1 + inc.growthRate, yearsElapsed);
    }
    const key = incomeTypeToKey[inc.type];
    result[key] += amount;
    result.bySource[inc.id] = amount;
  }

  result.total =
    result.salaries +
    result.socialSecurity +
    result.business +
    result.trust +
    result.deferred +
    result.capitalGains +
    result.other;

  return result;
}
