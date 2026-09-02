import { splitAnnuityDistribution } from "./annuity/tax";
import { computeTradIraPool, iraPoolKey, isTraditionalIra, proRataBasisReturn, type TradIraPool } from "./ira-basis";
import type { WithdrawalPriority, Account } from "./types";

interface WithdrawalResult {
  byAccount: Record<string, number>;
  total: number;
}

/** HSA withdrawals are penalty-free only at 65+. Before 65 the engine never
 *  draws from an HSA (we don't model voluntarily incurring the 20% penalty).
 *  Keyed off the account OWNER's age — callers pass the resolved owner age. */
export function isHsaWithdrawalLocked(account: Account, ownerAge: number): boolean {
  return account.category === "retirement" && account.subType === "hsa" && ownerAge < 65;
}

export interface SupplementalDraw {
  accountId: string;
  amount: number;                 // gross amount drawn from this account
  ordinaryIncome: number;         // contribution to taxDetail.ordinaryIncome
  capitalGains: number;           // contribution to taxDetail.capitalGains (LTCG)
  /** Portion of `amount` that was return-of-basis (no tax). For taxable
   *  sources only; 0 for retirement/cash/etc. Source-side basisMap should
   *  be reduced by this amount. */
  basisReturn: number;
  earlyWithdrawalPenalty: number; // 10% on Trad pre-59.5 / Roth earnings pre-59.5
}

export interface SupplementalWithdrawalPlan {
  byAccount: Record<string, number>;   // gross amounts (compatible with current `withdrawals.byAccount`)
  total: number;
  draws: SupplementalDraw[];
  recognizedIncome: {
    ordinaryIncome: number;
    capitalGains: number;
    earlyWithdrawalPenalty: number;
  };
}

export interface CategorizeDrawInput {
  account: Account;
  amount: number;
  /** Live pre-draw balance. The Account.value field is an immutable snapshot
   *  taken at projection start and drifts from the truth as the plan runs —
   *  callers must pass the current balance from their ledger. */
  balance: number;
  basisMap: Record<string, number>;
  /** Unspent portion of this year's basisIncrease for taxable/cash accounts.
   *  When > 0, dollars up to this amount are drawn from the fresh pool first
   *  (0 LTCG, 100% basisReturn). Caller manages the running counter. */
  freshBasisRemaining?: number;
  /** Live pre-draw Roth-designated portion for 401k/403b sources. Optional;
   *  callers that don't track rothValue can omit it (treated as 0). */
  rothValueMap?: Record<string, number>;
  /** Annuity sources only: LIVE unrecovered §72 basis from the projection's
   *  contract state. `Account.annuity.costBasis` is the ORIGINAL figure and is
   *  never decremented, so falling back to it re-shelters basis the household
   *  has already recovered — every year, for as long as the draws run. */
  annuityRemainingBasis?: number;
  /** Traditional-IRA sources only: the OWNER's live Form 8606 pool (every
   *  Trad/SEP/SIMPLE IRA they hold). The post-tax basis slice of the draw is
   *  pro-rata across that pool, not this one account. Omitted ⇒ the draw is
   *  fully taxable, which is the correct answer for a $0-basis pool. */
  tradIraPool?: TradIraPool;
  ownerAge: number;
}

export function categorizeDraw(input: CategorizeDrawInput): SupplementalDraw {
  const { account, amount, balance, basisMap, rothValueMap, ownerAge } = input;
  const accountId = account.id;
  const empty: SupplementalDraw = { accountId, amount, ordinaryIncome: 0, capitalGains: 0, basisReturn: 0, earlyWithdrawalPenalty: 0 };

  if (amount <= 0) return empty;

  // 529 education-savings: qualified education withdrawals are federal-tax-free,
  // regardless of how the account is categorized. (Import paths classify 529 as
  // `taxable`, so this MUST run before the taxable/retirement branches.) v1 treats
  // all 529 draws as qualified — no non-qualified distinction yet.
  if (account.subType === "529") return { ...empty, basisReturn: amount };

  // Cash: 0% tax, no penalty. Entire draw is return of principal (basis).
  if (account.category === "cash") return { ...empty, basisReturn: amount };

  // Taxable brokerage: high-basis-first ordering (spec 2026-05-11).
  // Current-year basisIncrease (passed in as freshBasisRemaining) has 100%
  // basis; draw from it before the legacy pool. The legacy slice uses the
  // pre-fresh basis ratio.
  if (account.category === "taxable") {
    const basis = basisMap[accountId] ?? 0;
    const fresh = Math.max(0, input.freshBasisRemaining ?? 0);
    if (balance <= 0) {
      return { ...empty, capitalGains: amount, basisReturn: 0 };
    }

    const freshDraw = Math.min(amount, fresh);
    const legacyDraw = amount - freshDraw;
    const legacyValue = balance - fresh;
    const legacyBasis = basis - fresh;

    // Signed: a ratio below 0 means the lot is underwater and the draw
    // realizes a proportional LOSS. Capped above at 1 (basis cannot go
    // negative), uncapped below — a 2x-basis account yields a ratio of -1.
    let legacyGainRatio = 0;
    if (legacyValue > 0) {
      legacyGainRatio = Math.min(1, 1 - legacyBasis / legacyValue);
    }

    // Guard the multiply: with a signed (possibly negative) ratio, a zero
    // legacy draw would otherwise hand back -0, which formats as "-$0.00".
    const capitalGains = legacyDraw === 0 ? 0 : legacyDraw * legacyGainRatio;
    const basisReturn = freshDraw + legacyDraw * (1 - legacyGainRatio);
    return { ...empty, capitalGains, basisReturn };
  }

  // Annuity: IRC §72. Two things here are the opposite of their neighbours and
  // must not be "harmonized" away:
  //   1. Ordering is gain-FIRST (LIFO, §72(e)(2)(B)). The Roth branch below is
  //      basis-first; the taxable branch above is pro-rata.
  //   2. The taxable slice is ORDINARY INCOME, never a capital gain — even
  //      though the contract holds market investments.
  if (account.category === "annuity") {
    const contract = account.annuity;
    // Live basis first; the contract's original figure only when the caller
    // tracks none. Both undefined means basis = balance — no gain, no invented
    // tax — which `splitAnnuityDistribution` applies as its own default.
    const split = splitAnnuityDistribution({
      treatment: contract?.taxTreatment ?? "non_qualified",
      amount,
      accountValue: balance,
      remainingBasis: input.annuityRemainingBasis ?? contract?.costBasis,
      ownerAge,
    });
    return { ...empty, ...split };
  }

  // Retirement: traditional vs Roth vs HSA
  if (account.category === "retirement") {
    // HSA: every draw that reaches here is tax-free — a qualified-medical /
    // post-65 distribution (zero ordinary income, zero penalty). The pre-65
    // lock is enforced upstream by the strategy walk (isHsaWithdrawalLocked),
    // so a pre-65 HSA draw never reaches this branch.
    if (account.subType === "hsa") return empty;

    const isRoth = account.subType === "roth_ira";
    const is401kOr403b = account.subType === "401k" || account.subType === "403b";
    const isPreAge = ownerAge < 59.5;

    if (isRoth) {
      // F2 ordering: contributions/basis come out first, tax- and penalty-free
      const basis = basisMap[accountId] ?? 0;
      const earningsWithdrawn = Math.max(0, amount - basis);
      const ordinaryIncome = isPreAge ? earningsWithdrawn : 0; // post-59.5 qualified Roth earnings are tax-free
      const penalty = isPreAge ? earningsWithdrawn * 0.1 : 0;
      return { ...empty, ordinaryIncome, earlyWithdrawalPenalty: penalty };
    }

    if (is401kOr403b) {
      // Pro-rata Roth slice from rothValue is tax- and penalty-free; the
      // pre-tax remainder is OI plus the 10% penalty when pre-59.5.
      const rothValue = rothValueMap?.[accountId] ?? 0;
      const rothFraction = balance > 0
        ? Math.max(0, Math.min(1, rothValue / balance))
        : 0;
      const taxableOI = amount * (1 - rothFraction);
      const penalty = isPreAge ? taxableOI * 0.1 : 0;
      return { ...empty, ordinaryIncome: taxableOI, earlyWithdrawalPenalty: penalty };
    }

    // Traditional / SEP / SIMPLE IRA: the post-tax basis the owner has in the
    // aggregated Form 8606 pool comes back tax-free, pro-rata. Basis cannot be
    // cherry-picked, so this is NOT `basisMap[accountId]` — a sibling IRA's
    // basis shelters this draw too, and this account's basis shelters the
    // sibling's. The caller passes the walked-down pool.
    if (isTraditionalIra(account)) {
      const basisReturn = proRataBasisReturn(amount, input.tradIraPool ?? { balance: 0, basis: 0 });
      const ordinaryIncome = amount - basisReturn;
      // §72(t) is an additional tax on the amount INCLUDIBLE in gross income;
      // returned post-tax dollars are not includible and carry no penalty.
      const iraPenalty = isPreAge ? ordinaryIncome * 0.1 : 0;
      return { ...empty, ordinaryIncome, basisReturn, earlyWithdrawalPenalty: iraPenalty };
    }

    // 401(a) / other tax-deferred: full draw is ordinary income; 10% penalty pre-59.5
    const penalty = isPreAge ? amount * 0.1 : 0;
    return { ...empty, ordinaryIncome: amount, earlyWithdrawalPenalty: penalty };
  }

  // real_estate / business / life_insurance — strategy walk filters these via
  // categoryWithdrawalPriority, so they should never reach categorizeDraw.
  // (`annuity` used to fall through here and come out UNTAXED — see the branch
  // above. Do not let a new category land in this default silently.)
  return empty;
}

/** taxDetail.bySource entries that supplemental draws contribute, keyed
 *  `withdrawal:<acctId>` (recognized income) and `withdrawal_tax_free:<acctId>`
 *  (display-only non-taxable slice). ACCUMULATES per account: when one account
 *  is drawn twice in a year (same accountId in two WithdrawalPriority rows), a
 *  naive assignment would let the 2nd draw overwrite the 1st while the income
 *  totals sum both — a silent grossSubtotal drift, since `non_taxable` isn't in
 *  the ledger's reconciled character set. `taxFreeSlice` returns the untaxed
 *  retirement slice of a draw (0 for taxable/cash sources). */
export function supplementalDrawSources(
  draws: SupplementalDraw[],
  taxFreeSlice: (draw: SupplementalDraw) => number,
): Record<string, { type: string; amount: number }> {
  const out: Record<string, { type: string; amount: number }> = {};
  // `??=` locks `type` to the first draw seen for a key; a repeat draw on the
  // same account only accumulates `amount` (both draws share the account's tax
  // treatment, so the type never conflicts).
  const add = (key: string, type: string, amount: number) => {
    (out[key] ??= { type, amount: 0 }).amount += amount;
  };
  for (const draw of draws) {
    // Signed: an underwater taxable draw recognizes a LOSS, and
    // planSupplementalWithdrawal folds it into the recognized-income TOTAL
    // unconditionally (`totalCapGains += draw.capitalGains`, in the draw loop
    // below). Gating on `> 0` here dropped the row while the total kept the
    // loss, so the drill-down contradicted its own total.
    // `!== 0` is also the -0 guard — `-0 !== 0` is false.
    //
    // ONE key still suffices: categorizeDraw sets at most one of
    // ordinaryIncome / capitalGains per draw (its branches are per-account-
    // category and mutually exclusive), and `add` only ever merges draws on the
    // same account, which share that category. So the ternary picks between
    // alternatives that cannot co-occur — unlike the education draw, which
    // aggregates across accounts and genuinely needed splitting.
    const recognized = draw.ordinaryIncome + draw.capitalGains;
    if (recognized !== 0) {
      add(`withdrawal:${draw.accountId}`, draw.ordinaryIncome > 0 ? "ordinary_income" : "capital_gains", recognized);
    }
    // Separate key so a mixed draw can carry both a taxable and a tax-free row.
    const taxFree = taxFreeSlice(draw);
    if (taxFree > 0) add(`withdrawal_tax_free:${draw.accountId}`, "tax_free", taxFree);
  }
  return out;
}

export interface PlanSupplementalWithdrawalInput {
  shortfall: number;
  strategy: WithdrawalPriority[];
  householdBalances: Record<string, number>;
  basisMap: Record<string, number>;
  /** Per-account unspent fresh-basis pool (current-year basisIncrease that
   *  hasn't been consumed by an earlier in-year withdrawal/transfer).
   *  Caller is responsible for decrementing after the plan applies. */
  freshBasisMap?: Record<string, number>;
  rothValueMap?: Record<string, number>;
  /** Live unrecovered §72 basis per annuity account. READ-ONLY: this function
   *  is re-run many times per year by the caller's tax-convergence loop, so it
   *  works on a local copy and never mutates the caller's map. The caller
   *  decrements the real one ONCE, when the converged plan is applied. */
  annuityBasisMap?: Record<string, number>;
  accounts: Account[];
  ages: { client: number; spouse: number | null };
  isSpouseAccount: (account: Account) => boolean;
  year: number;
}

export function planSupplementalWithdrawal(input: PlanSupplementalWithdrawalInput): SupplementalWithdrawalPlan {
  const { shortfall, strategy, householdBalances, basisMap, freshBasisMap, rothValueMap, annuityBasisMap, accounts, ages, isSpouseAccount, year } = input;

  const empty: SupplementalWithdrawalPlan = {
    byAccount: {}, total: 0, draws: [],
    recognizedIncome: { ordinaryIncome: 0, capitalGains: 0, earlyWithdrawalPenalty: 0 },
  };
  if (shortfall <= 0) return empty;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const sorted = [...strategy]
    .filter((s) => year >= s.startYear && year <= s.endYear)
    .sort((a, b) => a.priorityOrder - b.priorityOrder);

  // Local copy so we can decrement as we plan across multiple accounts and
  // a second draw from the same account in the same plan sees the depleted pool.
  const localFresh: Record<string, number> = { ...(freshBasisMap ?? {}) };
  // Same reason as localFresh: a second draw from the same annuity inside ONE
  // plan must see the basis the first draw already consumed. A local copy also
  // keeps the caller's map untouched across convergence iterations.
  const localAnnuityBasis: Record<string, number> = { ...(annuityBasisMap ?? {}) };
  // Same reason again, one level up: the Form 8606 pool is shared by every
  // Trad/SEP/SIMPLE IRA one taxpayer owns, so draw #2 must see the basis draw
  // #1 already used — otherwise the same post-tax dollars shelter income twice.
  // Built lazily per owner and walked down as the plan is laid out; the
  // caller's basisMap is never touched (this runs inside a convergence loop).
  const localTradIraPools = new Map<string, TradIraPool>();
  const tradIraPoolFor = (account: Account): TradIraPool | undefined => {
    if (!isTraditionalIra(account)) return undefined;
    const key = iraPoolKey(account);
    if (key == null) return undefined;
    let pool = localTradIraPools.get(key);
    if (!pool) {
      pool = computeTradIraPool(accounts, householdBalances, basisMap, key);
      localTradIraPools.set(key, pool);
    }
    return pool;
  };

  const draws: SupplementalDraw[] = [];
  const byAccount: Record<string, number> = {};
  let remaining = shortfall;
  let totalOrdinary = 0;
  let totalCapGains = 0;
  let totalPenalty = 0;

  for (const entry of sorted) {
    if (remaining <= 0) break;

    const account = accountById.get(entry.accountId);
    if (!account) continue;
    const available = householdBalances[entry.accountId] ?? 0;
    if (available <= 0) continue;

    const ownerAge = isSpouseAccount(account) && ages.spouse != null ? ages.spouse : ages.client;
    if (isHsaWithdrawalLocked(account, ownerAge)) continue;   // pre-65 HSA is locked

    const drawAmount = Math.min(remaining, available);
    const tradIraPool = tradIraPoolFor(account);
    const draw = categorizeDraw({
      account, amount: drawAmount, balance: available,
      basisMap, rothValueMap, ownerAge,
      freshBasisRemaining: localFresh[account.id] ?? 0,
      annuityRemainingBasis: localAnnuityBasis[account.id],
      tradIraPool,
    });

    if (account.category === "taxable") {
      const consumed = Math.min(localFresh[account.id] ?? 0, drawAmount);
      localFresh[account.id] = Math.max(0, (localFresh[account.id] ?? 0) - consumed);
    }
    if (account.category === "annuity" && localAnnuityBasis[account.id] != null) {
      localAnnuityBasis[account.id] = Math.max(
        0,
        localAnnuityBasis[account.id] - draw.basisReturn,
      );
    }
    if (tradIraPool) {
      // Both legs move: the distribution leaves the pool and takes its
      // pro-rata slice of basis with it.
      tradIraPool.balance = Math.max(0, tradIraPool.balance - drawAmount);
      tradIraPool.basis = Math.max(0, tradIraPool.basis - draw.basisReturn);
    }

    draws.push(draw);
    byAccount[entry.accountId] = drawAmount;
    totalOrdinary += draw.ordinaryIncome;
    totalCapGains += draw.capitalGains;
    totalPenalty += draw.earlyWithdrawalPenalty;
    remaining -= drawAmount;
  }

  const total = draws.reduce((sum, d) => sum + d.amount, 0);
  return {
    byAccount, total, draws,
    recognizedIncome: {
      ordinaryIncome: totalOrdinary,
      capitalGains: totalCapGains,
      earlyWithdrawalPenalty: totalPenalty,
    },
  };
}

export function executeWithdrawals(
  deficit: number,
  strategy: WithdrawalPriority[],
  accountBalances: Record<string, number>,
  year: number
): WithdrawalResult {
  const byAccount: Record<string, number> = {};
  let remaining = Math.max(0, deficit);

  if (remaining === 0) return { byAccount, total: 0 };

  const sorted = [...strategy]
    .filter((s) => year >= s.startYear && year <= s.endYear)
    .sort((a, b) => a.priorityOrder - b.priorityOrder);

  for (const entry of sorted) {
    if (remaining <= 0) break;

    const available = accountBalances[entry.accountId] ?? 0;
    if (available <= 0) continue;

    const withdrawal = Math.min(remaining, available);
    byAccount[entry.accountId] = withdrawal;
    remaining -= withdrawal;
  }

  const total = Object.values(byAccount).reduce((sum, v) => sum + v, 0);
  return { byAccount, total };
}

export interface WithdrawalPenaltyInput {
  amount: number;
  accountCategory: string;
  accountSubType: string;
  ownerAge: number;
  rothBasis: number;
}

export function computeWithdrawalPenalty(input: WithdrawalPenaltyInput): number {
  const { amount, accountCategory, accountSubType, ownerAge, rothBasis } = input;

  if (accountCategory !== "retirement") return 0;
  if (ownerAge >= 59.5) return 0;

  if (accountSubType === "roth_ira") {
    const earningsWithdrawn = Math.max(0, amount - rothBasis);
    return earningsWithdrawn * 0.1;
  }

  return amount * 0.1;
}
