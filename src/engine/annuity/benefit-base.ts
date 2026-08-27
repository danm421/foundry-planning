import type { AnnuityContract } from "./types";

/**
 * Industry-representative GLWB payout bands. These are DEFAULTS for illustration
 * when the advisor hasn't entered the contract's actual schedule — carriers
 * differ, and the real number belongs on the contract (`payoutPct`).
 *
 * Sorted descending by minAge so the first match wins.
 */
export const GLWB_PAYOUT_BANDS: ReadonlyArray<{ minAge: number; percent: number }> = [
  { minAge: 80, percent: 0.065 },
  { minAge: 75, percent: 0.060 },
  { minAge: 70, percent: 0.055 },
  { minAge: 65, percent: 0.050 },
  { minAge: 60, percent: 0.045 },
  { minAge: 0,  percent: 0.040 },
];

export function payoutPercentForAge(age: number): number {
  for (const band of GLWB_PAYOUT_BANDS) {
    if (age >= band.minAge) return band.percent;
  }
  return GLWB_PAYOUT_BANDS[GLWB_PAYOUT_BANDS.length - 1].percent;
}

export function resolvePayoutPercent(contract: AnnuityContract, ageAtActivation: number): number {
  const payoutPct = contract.payoutPct ?? payoutPercentForAge(ageAtActivation);
  if (!Number.isFinite(payoutPct) || payoutPct < 0 || payoutPct > 1) {
    throw new Error(`payoutPct out of [0,1]: ${payoutPct}`);
  }
  return payoutPct;
}

export interface RollupInput {
  contract: AnnuityContract;
  currentBase: number;
  accountValue: number;
  year: number;
  incomeActive: boolean;
}

/**
 * Advance the benefit base by one year.
 *
 * The base is a phantom number that exists only to size income. It rolls up at
 * a guaranteed rate while income is OFF, optionally ratcheting to the account
 * value when the market does better. Turning income on freezes it — which is
 * why an advisor delaying income is a real, illustrable decision.
 *
 * It is a floor: it never decreases, no matter what the account value does.
 */
export function rollBenefitBase(input: RollupInput): number {
  const { contract, currentBase, accountValue, year, incomeActive } = input;

  if (incomeActive) return currentBase;
  if (contract.rollupEndYear != null && year > contract.rollupEndYear) return currentBase;

  const rollupRate = contract.rollupRate ?? 0;
  if (!Number.isFinite(rollupRate) || rollupRate < 0 || rollupRate > 1) {
    throw new Error(`rollupRate out of [0,1]: ${rollupRate}`);
  }

  const rolled = currentBase * (1 + rollupRate);
  if (!contract.rollupRatchets) return rolled;
  return Math.max(rolled, accountValue);
}
