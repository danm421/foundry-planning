/** SECURE 2.0 §126: leftover 529 funds may roll to the beneficiary's Roth IRA.
 *  v1 enforces the $35,000 lifetime cap and the annual IRA contribution limit.
 *  The 15-year account-age gate and 5-year contribution lookback are NOT
 *  modeled (logged in future-work), and the beneficiary's own earned-income
 *  limit on the annual Roth contribution is intentionally ignored (v1
 *  simplification). Framework-free. */
export const ROLLOVER_529_LIFETIME_CAP = 35_000;

export interface Rollover529Input {
  balance: number;
  lifetimeRolledSoFar: number;
  annualIraLimit: number;
}
export interface Rollover529Result {
  amount: number;
  lifetimeRolledAfter: number;
}

export function computeRoth529Rollover(input: Rollover529Input): Rollover529Result {
  const lifetimeRemaining = Math.max(0, ROLLOVER_529_LIFETIME_CAP - input.lifetimeRolledSoFar);
  const amount = Math.max(0, Math.min(input.balance, input.annualIraLimit, lifetimeRemaining));
  return { amount, lifetimeRolledAfter: input.lifetimeRolledSoFar + amount };
}
