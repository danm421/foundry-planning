import type { WithdrawalPriority, Account } from "./types";

interface WithdrawalResult {
  byAccount: Record<string, number>;
  total: number;
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
  ownerAge: number;
}

export function categorizeDraw(input: CategorizeDrawInput): SupplementalDraw {
  const { account, amount, balance, basisMap, rothValueMap, ownerAge } = input;
  const accountId = account.id;
  const empty: SupplementalDraw = { accountId, amount, ordinaryIncome: 0, capitalGains: 0, basisReturn: 0, earlyWithdrawalPenalty: 0 };

  if (amount <= 0) return empty;

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

    let legacyGainRatio = 0;
    if (legacyValue > 0) {
      const raw = 1 - legacyBasis / legacyValue;
      legacyGainRatio = Math.max(0, Math.min(1, raw));
    }

    const capitalGains = legacyDraw * legacyGainRatio;
    const basisReturn = freshDraw + legacyDraw * (1 - legacyGainRatio);
    return { ...empty, capitalGains, basisReturn };
  }

  // Retirement: traditional vs Roth vs HSA
  if (account.category === "retirement") {
    // HSA: v1 — assume qualified-medical, treat as tax-free
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

    // Traditional IRA / other tax-deferred: full draw is ordinary income; 10% penalty pre-59.5
    const penalty = isPreAge ? amount * 0.1 : 0;
    return { ...empty, ordinaryIncome: amount, earlyWithdrawalPenalty: penalty };
  }

  // real_estate / business / life_insurance — strategy walk filters these via categoryWithdrawalPriority,
  // so they should never reach categorizeDraw. Return empty defensively.
  return empty;
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
  accounts: Account[];
  ages: { client: number; spouse: number | null };
  isSpouseAccount: (account: Account) => boolean;
  year: number;
}

export function planSupplementalWithdrawal(input: PlanSupplementalWithdrawalInput): SupplementalWithdrawalPlan {
  const { shortfall, strategy, householdBalances, basisMap, freshBasisMap, rothValueMap, accounts, ages, isSpouseAccount, year } = input;

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

    const drawAmount = Math.min(remaining, available);
    const ownerAge = isSpouseAccount(account) && ages.spouse != null ? ages.spouse : ages.client;
    const draw = categorizeDraw({
      account, amount: drawAmount, balance: available,
      basisMap, rothValueMap, ownerAge,
      freshBasisRemaining: localFresh[account.id] ?? 0,
    });

    if (account.category === "taxable") {
      const consumed = Math.min(localFresh[account.id] ?? 0, drawAmount);
      localFresh[account.id] = Math.max(0, (localFresh[account.id] ?? 0) - consumed);
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
