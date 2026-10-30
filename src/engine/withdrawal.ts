import { splitAnnuityDistribution } from "./annuity/tax";
import { computeTradIraPool, iraPoolKey, isTraditionalIra, proRataBasisReturn, type TradIraPool } from "./ira-basis";
import { isInheritedIra } from "./inherited-ira";
import type { WithdrawalPriority, Account } from "./types";
import { type MarginBorrowSource, type MarginMap, equityPinnedByLoan } from "./margin";
import { splitTotal, withdrawalGroupOf, type WithdrawalGroup } from "./withdrawal-policy";

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
  /** A margin borrow (spec 2026-10-14): no gain, no basis, no penalty — the
   *  loan grows instead of securities being sold. Absent on every sale. */
  borrowed?: true;
}

export interface SupplementalWithdrawalPlan {
  /** Gross amount SOLD per account — sales only; a margin borrow is never in it. */
  byAccount: Record<string, number>;
  /** Σ `draws`, borrows included — so when the plan borrows, `total` ≠ Σ `byAccount`. */
  total: number;
  draws: SupplementalDraw[];
  /** Amount borrowed on margin per account (in `total`, not in `byAccount`).
   *  Present only when the plan borrowed. */
  borrowedByAccount?: Record<string, number>;
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
  /** Taxable only: the securities value (net + margin loan) for the gain
   *  ratio. Omitted ⇒ `balance` (no loan: net == gross). */
  grossBalance?: number;
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
    const ratioValue = input.grossBalance ?? balance;

    const freshDraw = Math.min(amount, fresh);
    const legacyDraw = amount - freshDraw;
    const legacyValue = ratioValue - fresh;
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
    // Distributions from an inherited IRA are "on account of death" — never
    // penalized (§72(t)(2)(A)(ii)). Treating the heir as past 59½ also makes an
    // inherited Roth's earnings come out tax-free, which is the rule once the
    // original owner's 5-year clock is met (assumed).
    const isPreAge = ownerAge < 59.5 && !isInheritedIra(account);

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
  /** Securities value (net + margin loan) per margined account, from
   *  `grossBalancesFor` — the gain-ratio denominator. Draws are still capped
   *  at `householdBalances` (net). */
  grossBalances?: Record<string, number>;
  /** The live loan per margined account (`equityPinnedByLoan`). */
  marginLoans?: MarginMap;
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
  /** This year's margin borrowing sources, in the order to use them (from
   *  `marginBorrowSourcesFor`). The borrow step runs ONCE, just before the
   *  first non-cash row of the year's strategy (after them all when every row
   *  is cash). Omitted ⇒ no borrowing — the legacy no-checking path never
   *  borrows. */
  marginBorrowSources?: MarginBorrowSource[];
  /** How the shortfall is shared out (spec 2026-10-29). Omitted ⇒ the
   *  strategy is walked in order, each account drained before the next. */
  allocation?: WithdrawalAllocation;
}

/** A non-sequential withdrawal method. `split` shares the draw across groups
 *  by `splitPct` and passes any share a group can't cover down the strategy's
 *  order; `proportional` draws every account in proportion to what it can give.
 *  Either way a margin borrow comes before any sale. */
export type WithdrawalAllocation =
  | { method: "split"; splitPct: Partial<Record<WithdrawalGroup, number>>; groupOrder: WithdrawalGroup[] }
  | { method: "proportional" };

/** Each account's share of `total` under `allocation`. `entries` arrive in the
 *  strategy's order with what each account can give (`cap`). */
function allocateShortfall(
  total: number,
  entries: Array<{ accountId: string; group: WithdrawalGroup | null; cap: number }>,
  allocation: WithdrawalAllocation,
): Map<string, number> {
  const amounts = new Map<string, number>();
  if (allocation.method === "proportional") {
    const capTotal = entries.reduce((s, e) => s + e.cap, 0);
    if (capTotal <= 0) return amounts;
    const fraction = Math.min(1, total / capTotal);
    for (const e of entries) amounts.set(e.accountId, e.cap * fraction);
    return amounts;
  }

  const left = new Map(entries.map((e) => [e.accountId, e.cap]));
  const take = (accountId: string, want: number): number => {
    const t = Math.min(want, left.get(accountId) ?? 0);
    left.set(accountId, (left.get(accountId) ?? 0) - t);
    amounts.set(accountId, (amounts.get(accountId) ?? 0) + t);
    return t;
  };
  const shareTotal = splitTotal(allocation.splitPct);
  let unmet = 0;
  for (const group of allocation.groupOrder) {
    const share = allocation.splitPct[group] ?? 0;
    if (share <= 0 || shareTotal <= 0) continue;
    let want = (total * share) / shareTotal;
    for (const e of entries) {
      if (want <= 0) break;
      if (e.group === group) want -= take(e.accountId, want);
    }
    unmet += want;
  }
  // Whatever a group couldn't give continues down the list — the other split
  // groups first, then the 0% groups, which are used only once those run out.
  const hasShare = (e: (typeof entries)[number]) => e.group != null && (allocation.splitPct[e.group] ?? 0) > 0;
  for (const pass of [entries.filter(hasShare), entries.filter((e) => !hasShare(e))]) {
    for (const e of pass) {
      if (unmet <= 0) break;
      unmet -= take(e.accountId, unmet);
    }
  }
  return amounts;
}

export function planSupplementalWithdrawal(input: PlanSupplementalWithdrawalInput): SupplementalWithdrawalPlan {
  const first = layOutDraws(input, {});
  if (first.remaining <= 0 || Object.keys(first.belowCallLevel).length === 0) return first.plan;
  // Every other source is spent: release the equity the margin loans pin and
  // lay the plan out again, so each account is still drawn (and taxed) once.
  const released = executeWithdrawals(first.remaining, input.strategy, first.belowCallLevel, input.year).byAccount;
  return layOutDraws(input, released).plan;
}

interface LaidOutDraws {
  plan: SupplementalWithdrawalPlan;
  /** The part of the shortfall the plan left uncovered. */
  remaining: number;
  /** The equity each margin loan pins, beyond what this walk could sell. */
  belowCallLevel: Record<string, number>;
}

/** One walk of the year's withdrawal order; `released` frees pinned equity. */
function layOutDraws(input: PlanSupplementalWithdrawalInput, released: Record<string, number>): LaidOutDraws {
  const { shortfall, strategy, householdBalances, grossBalances, marginLoans, basisMap, freshBasisMap, rothValueMap, annuityBasisMap, accounts, ages, isSpouseAccount, year, marginBorrowSources, allocation } = input;

  const empty: SupplementalWithdrawalPlan = {
    byAccount: {}, total: 0, draws: [],
    recognizedIncome: { ordinaryIncome: 0, capitalGains: 0, earlyWithdrawalPenalty: 0 },
  };
  if (shortfall <= 0) return { plan: empty, remaining: 0, belowCallLevel: {} };

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
  const belowCallLevel: Record<string, number> = {};
  let remaining = shortfall;
  let totalOrdinary = 0;
  let totalCapGains = 0;
  let totalPenalty = 0;
  // Margin borrowing (spec 2026-10-14). Runs once, before the first non-cash
  // source. Planned on locals only: this function is re-run many times per
  // year by the caller's convergence loop, and the loan moves once, where the
  // converged plan is applied.
  let borrowStepDone = false;
  const borrowedFrom: Record<string, number> = {};
  const borrowStep = () => {
    borrowStepDone = true;
    for (const src of marginBorrowSources ?? []) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, src.headroom);
      if (amount <= 0) continue;
      draws.push({ accountId: src.accountId, amount, ordinaryIncome: 0, capitalGains: 0,
        basisReturn: 0, earlyWithdrawalPenalty: 0, borrowed: true });
      borrowedFrom[src.accountId] = (borrowedFrom[src.accountId] ?? 0) + amount;
      remaining -= amount;
    }
  };

  /** What this walk may sell from `account` right now, or null when nothing:
   *  net of any borrow in this plan, never a pre-65 HSA, and only down to the
   *  equity a margin loan pins (`released` frees that last). */
  const sourceFor = (account: Account) => {
    // Borrowing took `borrowedHere` out of net; the securities are untouched,
    // so a sale's gain ratio still divides by the pre-borrow securities value.
    const borrowedHere = borrowedFrom[account.id] ?? 0;
    const securities = grossBalances?.[account.id] ?? (borrowedHere > 0 ? householdBalances[account.id] : undefined);
    const available = (householdBalances[account.id] ?? 0) - borrowedHere;
    if (available <= 0) return null;

    const ownerAge = isSpouseAccount(account) && ages.spouse != null ? ages.spouse : ages.client;
    if (isHsaWithdrawalLocked(account, ownerAge)) return null;   // pre-65 HSA is locked

    // A margined account (a borrow in this plan counts) sells only down to the
    // equity its loan pins; `released` frees that last.
    const loan = (marginLoans?.[account.id] ?? 0) + borrowedHere;
    let drawable = available;
    if (loan > 0) {
      const free = Math.min(available, Math.max(0, (securities ?? 0) - loan - equityPinnedByLoan(account, loan)));
      if (free < available) belowCallLevel[account.id] = available - free;
      drawable = free + (released[account.id] ?? 0);
      if (drawable <= 0) return null;
    }
    return { available, securities, ownerAge, drawable };
  };
  type Source = NonNullable<ReturnType<typeof sourceFor>>;

  const record = (account: Account, source: Source, drawAmount: number) => {
    const tradIraPool = tradIraPoolFor(account);
    const draw = categorizeDraw({
      account, amount: drawAmount, balance: source.available,
      grossBalance: source.securities,
      basisMap, rothValueMap, ownerAge: source.ownerAge,
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
    byAccount[account.id] = drawAmount;
    totalOrdinary += draw.ordinaryIncome;
    totalCapGains += draw.capitalGains;
    totalPenalty += draw.earlyWithdrawalPenalty;
    remaining -= drawAmount;
  };

  if (allocation) {
    // Split / proportional: borrow first, share out the rest, then draw (and
    // tax) each account once, in the strategy's order.
    borrowStep();
    const sources = new Map<string, Source>();
    const entries: Array<{ accountId: string; group: WithdrawalGroup | null; cap: number }> = [];
    for (const entry of sorted) {
      const account = accountById.get(entry.accountId);
      if (!account || sources.has(account.id)) continue;
      const source = sourceFor(account);
      if (!source) continue;
      sources.set(account.id, source);
      entries.push({ accountId: account.id, group: withdrawalGroupOf(account), cap: source.drawable });
    }
    const amounts = allocateShortfall(Math.max(0, remaining), entries, allocation);
    for (const { accountId } of entries) {
      const amount = amounts.get(accountId) ?? 0;
      if (amount > 0) record(accountById.get(accountId)!, sources.get(accountId)!, amount);
    }
  } else {
    for (const entry of sorted) {
      if (remaining <= 0) break;

      const account = accountById.get(entry.accountId);
      if (!account) continue;
      if (!borrowStepDone && account.category !== "cash") borrowStep();
      if (remaining <= 0) break;
      const source = sourceFor(account);
      if (!source) continue;
      record(account, source, Math.min(remaining, source.drawable));
    }
    if (!borrowStepDone) borrowStep();
  }

  const total = draws.reduce((sum, d) => sum + d.amount, 0);
  const plan: SupplementalWithdrawalPlan = {
    byAccount, total, draws,
    ...(Object.keys(borrowedFrom).length > 0 ? { borrowedByAccount: borrowedFrom } : {}),
    recognizedIncome: {
      ordinaryIncome: totalOrdinary,
      capitalGains: totalCapGains,
      earlyWithdrawalPenalty: totalPenalty,
    },
  };
  return { plan, remaining, belowCallLevel };
}

export function executeWithdrawals(
  deficit: number,
  strategy: WithdrawalPriority[],
  accountBalances: Record<string, number>,
  year: number,
  /** Drawn in the same order once `accountBalances` is spent. */
  lastResort?: Record<string, number>,
): WithdrawalResult {
  const byAccount: Record<string, number> = {};
  let remaining = Math.max(0, deficit);

  if (remaining === 0) return { byAccount, total: 0 };

  const sorted = [...strategy]
    .filter((s) => year >= s.startYear && year <= s.endYear)
    .sort((a, b) => a.priorityOrder - b.priorityOrder);

  for (const balances of lastResort ? [accountBalances, lastResort] : [accountBalances]) {
    for (const entry of sorted) {
      if (remaining <= 0) break;

      const available = balances[entry.accountId] ?? 0;
      if (available <= 0) continue;

      const withdrawal = Math.min(remaining, available);
      byAccount[entry.accountId] = (byAccount[entry.accountId] ?? 0) + withdrawal;
      remaining -= withdrawal;
    }
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
