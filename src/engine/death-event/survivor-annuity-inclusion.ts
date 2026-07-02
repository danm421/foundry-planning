import type { Income, PlanSettings, GrossEstateLine } from "../types";
import { survivorAnnuityPresentValue } from "../actuarial/survivor-annuity";
import { resolvePvDiscountRate } from "../actuarial/discount-rate";

/** IRC §2039-style inclusion: the PV of the survivor's continuing benefit on a
 *  deferred income owned by the decedent is added to the decedent's gross
 *  estate. Only fires at first death (a spouse must survive to receive it). */
export function computeSurvivorAnnuityInclusion(input: {
  incomes: Income[];
  deceased: "client" | "spouse";
  deathYear: number;
  survivorBirthYear: number | null;
  survivorLifeExpectancy: number | null;
  planSettings: Pick<PlanSettings, "pvDiscountRate" | "inflationRate">;
}): { lines: GrossEstateLine[]; maritalDeduction: number } {
  const { incomes, deceased, deathYear, survivorBirthYear, survivorLifeExpectancy, planSettings } = input;
  if (survivorBirthYear == null || survivorLifeExpectancy == null) return { lines: [], maritalDeduction: 0 };

  const survivorDeathYear = survivorBirthYear + survivorLifeExpectancy;
  const survivorAgeAtDeath = deathYear - survivorBirthYear;
  const discountRate = resolvePvDiscountRate(planSettings);
  const lines: GrossEstateLine[] = [];
  let maritalDeduction = 0;

  for (const inc of incomes) {
    if (inc.type !== "deferred") continue;
    if (inc.owner !== deceased) continue;
    const pct = inc.survivorshipPct ?? 0;
    if (pct <= 0) continue;
    // scheduleOverrides bypasses annualAmount·growth in computeIncome — the PV
    // helper would value a stream the projection never pays. Survivorship is
    // unsupported for override-driven incomes; emit no inclusion line (matching
    // applyIncomeTermination, which clips rather than continuing these).
    if (inc.scheduleOverrides) continue;

    const pv = survivorAnnuityPresentValue({
      annualAmount: inc.annualAmount,
      growthRate: inc.growthRate,
      startYear: inc.startYear,
      inflationStartYear: inc.inflationStartYear,
      survivorshipPct: pct,
      survivorAgeAtDeath,
      deathYear,
      survivorDeathYear,
      discountRate,
    });
    if (pv <= 0) continue;

    lines.push({
      label: `Survivor annuity — ${inc.name}`,
      accountId: null,
      liabilityId: null,
      entityId: null,
      percentage: 1,
      amount: pv,
      // A survivor-annuity inclusion is a valuation add-back, not a probate asset.
      isProbate: false,
    });

    // §2056(b)(7)(C): the surviving spouse is (by construction of survivorshipPct)
    // the only continuing beneficiary, so the annuity is deemed QTIP and its PV is
    // offset by a marital deduction — unless the executor affirmatively elects out.
    if (inc.survivorAnnuityQtipElectOut !== true) {
      maritalDeduction += pv;
    }
  }
  return { lines, maritalDeduction };
}
