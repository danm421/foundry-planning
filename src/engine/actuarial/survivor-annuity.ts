import { survivalProbability } from "./mortality";

/**
 * Present value at the owner's death of the survivor's continuing benefit:
 *   PV = Σ_{t=1..T} survivorPct · benefit_{deathYear+t}
 *                   · P(survivor alive t yrs) / (1 + d)^t
 * where benefit_{y} = annualAmount · (1 + growthRate)^(y − inflateFrom),
 * inflateFrom = inflationStartYear ?? startYear (mirrors computeIncome), and
 * T = survivorDeathYear − deathYear. Returns 0 for a non-positive window.
 */
export function survivorAnnuityPresentValue(input: {
  annualAmount: number;
  growthRate: number;
  startYear: number;
  inflationStartYear?: number | null;
  survivorshipPct: number;
  survivorAgeAtDeath: number;
  deathYear: number;
  survivorDeathYear: number;
  discountRate: number;
}): number {
  const {
    annualAmount, growthRate, startYear, inflationStartYear,
    survivorshipPct, survivorAgeAtDeath, deathYear, survivorDeathYear, discountRate,
  } = input;

  const years = survivorDeathYear - deathYear;
  if (years <= 0 || survivorshipPct <= 0 || annualAmount <= 0) return 0;

  const inflateFrom = inflationStartYear ?? startYear;
  let pv = 0;
  for (let t = 1; t <= years; t++) {
    const benefitYear = deathYear + t;
    const nominal = annualAmount * Math.pow(1 + growthRate, benefitYear - inflateFrom);
    const payment = survivorshipPct * nominal;
    const pSurvive = survivalProbability(survivorAgeAtDeath, t);
    const discount = Math.pow(1 + discountRate, t);
    pv += (payment * pSurvive) / discount;
  }
  return pv;
}
