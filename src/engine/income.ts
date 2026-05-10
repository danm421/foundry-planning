import type { Income, ClientInfo } from "./types";
import { resolveAnnualBenefit } from "./socialSecurity/orchestrator";
import { resolveClaimAgeMonths } from "./socialSecurity/claimAge";

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

const incomeTypeToKey: Record<Income["type"], keyof Omit<IncomeBreakdown, "total" | "bySource" | "socialSecurityDetail">> = {
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
      if (inc.ssBenefitMode === "no_benefit") continue;
      const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
      if (!ownerDob) continue;
      const claimAgeMonths = resolveClaimAgeMonths(inc, client);
      if (claimAgeMonths == null) continue; // unresolvable mode (e.g., fra without DOB)
      const birthYear = parseInt(ownerDob.slice(0, 4), 10);
      if (year * 12 < birthYear * 12 + claimAgeMonths) continue;

      // Suppress the spouse's SS row after the spouse has died. The death year
      // itself runs to completion (matches applyIncomeTermination's convention
      // and effectiveFilingStatus, where the death year is the last alive year),
      // so suppression begins the year AFTER birthYear+lifeExpectancy.
      // The orchestrator handles the survivor top-up from the CLIENT's row; the
      // spouse row must stop contributing once the spouse is dead to avoid
      // double-counting. Use ?? 95 to match the orchestrator's default when
      // spouseLifeExpectancy is null.
      if (inc.owner === "spouse" && client.spouseDob) {
        const spouseBy = parseInt(client.spouseDob.slice(0, 4), 10);
        const effectiveSpouseLE = client.spouseLifeExpectancy ?? 95;
        if (year > spouseBy + effectiveSpouseLE) continue;
      }

      // Suppress the client's SS row after the client has died. Same convention:
      // death year (clientBirthYear + lifeExpectancy) is the last paid year.
      if (inc.owner === "client" && client.lifeExpectancy != null && client.dateOfBirth) {
        const clientBy = parseInt(client.dateOfBirth.slice(0, 4), 10);
        if (year > clientBy + client.lifeExpectancy) continue;
      }

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
      amount = inc.scheduleOverrides[year] ?? 0;
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
