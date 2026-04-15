import type { Income, ClientInfo } from "./types";

interface IncomeBreakdown {
  salaries: number;
  socialSecurity: number;
  business: number;
  trust: number;
  deferred: number;
  capitalGains: number;
  other: number;
  total: number;
}

const incomeTypeToKey: Record<Income["type"], keyof Omit<IncomeBreakdown, "total">> = {
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
  client: ClientInfo
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
  };

  for (const inc of incomes) {
    if (year < inc.startYear || year > inc.endYear) continue;

    // Social Security: delay until claiming age
    if (inc.type === "social_security" && inc.claimingAge != null) {
      const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
      if (!ownerDob) continue;
      const birthYear = parseInt(ownerDob.slice(0, 4), 10);
      const claimingYear = birthYear + inc.claimingAge;
      if (year < claimingYear) continue;
    }

    const yearsElapsed = year - inc.startYear;
    const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, yearsElapsed);
    const key = incomeTypeToKey[inc.type];
    result[key] += amount;
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
