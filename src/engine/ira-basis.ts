import { controllingFamilyMember, controllingEntity } from "./ownership";
import type { Account } from "./types";

/**
 * Form 8606 aggregation pool: Traditional IRAs ONLY — including SEP and SIMPLE.
 *
 * 401(k) / 403(b) after-tax dollars deliberately stay OUT. Those plans track
 * already-taxed money in `rothValue`, and their basis never joins the IRA
 * pro-rata pool (IRC §72(d), §408(d)(2) — plan balances are accounted for
 * separately from IRAs).
 */
export const TRAD_IRA_SUBTYPES = new Set(["traditional_ira", "sep_ira", "simple_ira"]);

export function isTraditionalIra(account: Pick<Account, "category" | "subType">): boolean {
  return account.category === "retirement" && TRAD_IRA_SUBTYPES.has(account.subType);
}

/** Aggregate balance and unrecovered post-tax basis across one taxpayer's
 *  Traditional IRAs. Both figures are LIVE — read from the projection's
 *  running balance/basis maps, never from the immutable Account snapshot. */
export interface TradIraPool {
  balance: number;
  basis: number;
}

export const EMPTY_TRAD_IRA_POOL: TradIraPool = { balance: 0, basis: 0 };

/**
 * The taxpayer whose Form 8606 an account rolls up into.
 *
 * §408(d)(2) aggregates per INDIVIDUAL, not per household: a spouse's basis
 * cannot shelter the other spouse's distribution. Retirement accounts carry
 * exactly one owner (DB CHECK trigger, migration 0055), so this is total —
 * a family-member id, an entity id, or null when ownership is malformed.
 */
export function iraPoolKey(account: Account): string | null {
  return controllingFamilyMember(account) ?? controllingEntity(account);
}

/**
 * Builds one taxpayer's Form 8606 pool.
 *
 * `poolKey` scopes the aggregation. Passing null returns an empty pool rather
 * than silently pooling every malformed account together — an unowned IRA
 * shelters nothing.
 */
export function computeTradIraPool(
  accounts: Account[],
  balances: Record<string, number>,
  basisMap: Record<string, number>,
  poolKey: string | null,
): TradIraPool {
  if (poolKey == null) return { ...EMPTY_TRAD_IRA_POOL };
  let balance = 0;
  let basis = 0;
  for (const account of accounts) {
    if (!isTraditionalIra(account)) continue;
    if (iraPoolKey(account) !== poolKey) continue;
    balance += balances[account.id] ?? 0;
    basis += basisMap[account.id] ?? 0;
  }
  return { balance, basis };
}

/**
 * The nontaxable slice of a Traditional-IRA distribution under the Form 8606
 * pro-rata rule: `amount × (pool basis / pool balance)`.
 *
 * Every distribution — a withdrawal, an RMD, or the distribution leg of a Roth
 * conversion — carries basis out in the same proportion. Basis cannot be
 * cherry-picked, which is why a $0-basis pool taxes the whole draw and a
 * fully-post-tax pool taxes none of it.
 *
 * Clamped to [0, amount]: a basis larger than the balance (a stale entry, or a
 * pool that shrank on a market loss) must not manufacture a negative taxable
 * amount that would shelter unrelated income.
 */
export function proRataBasisReturn(amount: number, pool: TradIraPool): number {
  if (amount <= 0) return 0;
  if (pool.balance <= 0 || pool.basis <= 0) return 0;
  const basisFraction = Math.min(1, pool.basis / pool.balance);
  return Math.min(amount, amount * basisFraction);
}

/**
 * Removes `basisUsed` of post-tax basis from a taxpayer's Form 8606 pool after
 * a distribution.
 *
 * Basis is a pool-level quantity, but `basisMap` is per-account, so the debit
 * takes from the distributing account first and spreads any remainder across
 * the owner's other Traditional IRAs, weighted by their remaining basis. That
 * ordering keeps the common single-IRA case exact (the slice never exceeds the
 * account's own basis) while still conserving basis pool-wide when it is
 * concentrated in a sibling IRA.
 *
 * Skipping this is what makes basis shelter the SAME dollars every year: the
 * balance falls, the basis does not, and the tax-free fraction climbs until the
 * whole distribution comes out untaxed.
 */
export function removePoolBasis(
  accounts: Account[],
  sourceId: string,
  basisUsed: number,
  basisMap: Record<string, number>,
  poolKey: string | null,
): void {
  if (basisUsed <= 0 || poolKey == null) return;

  const fromSource = Math.min(basisMap[sourceId] ?? 0, basisUsed);
  basisMap[sourceId] = (basisMap[sourceId] ?? 0) - fromSource;
  const remainder = basisUsed - fromSource;
  if (remainder <= 1e-9) return;

  const others = accounts.filter(
    (a) =>
      a.id !== sourceId &&
      isTraditionalIra(a) &&
      iraPoolKey(a) === poolKey &&
      (basisMap[a.id] ?? 0) > 0,
  );
  const otherBasisTotal = others.reduce((sum, a) => sum + (basisMap[a.id] ?? 0), 0);
  if (otherBasisTotal <= 0) return;

  for (const a of others) {
    const share = (basisMap[a.id] ?? 0) / otherBasisTotal;
    const take = Math.min(basisMap[a.id] ?? 0, remainder * share);
    basisMap[a.id] = (basisMap[a.id] ?? 0) - take;
  }
}
