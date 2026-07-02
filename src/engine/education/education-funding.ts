/** Pure education-goal funding math: draw a goal's cost from its dedicated
 *  accounts in order (preferred-first), capping at each account's balance, and
 *  report the uncovered shortfall + aggregated taxable components. Framework-free.
 */

export interface EducationDrawTax {
  ordinaryIncome: number;
  capitalGains: number;
  basisReturn: number;
  earlyWithdrawalPenalty: number;
}

export interface EducationDrawInput {
  /** Indexed goal cost for the year (>= 0). */
  goalCost: number;
  /** Dedicated funding account ids, in draw order. */
  dedicatedAccountIds: string[];
  /** Current available balance per account id. */
  balances: Record<string, number>;
  /** Tax categorizer for a draw of `amount` from `accountId` (e.g. wraps categorizeDraw). */
  categorize: (accountId: string, amount: number) => EducationDrawTax;
}

export interface EducationDraw extends EducationDrawTax {
  accountId: string;
  amount: number;
}

export interface EducationDrawResult {
  draws: EducationDraw[];
  dedicatedWithdrawal: number;
  shortfall: number;
  ordinaryIncome: number;
  capitalGains: number;
  earlyWithdrawalPenalty: number;
}

export function computeEducationDraw(input: EducationDrawInput): EducationDrawResult {
  const { goalCost, dedicatedAccountIds, balances, categorize } = input;
  let remaining = Math.max(0, goalCost);
  const draws: EducationDraw[] = [];
  let ordinaryIncome = 0;
  let capitalGains = 0;
  let earlyWithdrawalPenalty = 0;

  for (const id of dedicatedAccountIds) {
    if (remaining <= 0) break;
    const available = Math.max(0, balances[id] ?? 0);
    if (available <= 0) continue;
    const amount = Math.min(remaining, available);
    const tax = categorize(id, amount);
    draws.push({ accountId: id, amount, ...tax });
    ordinaryIncome += tax.ordinaryIncome;
    capitalGains += tax.capitalGains;
    earlyWithdrawalPenalty += tax.earlyWithdrawalPenalty;
    remaining -= amount;
  }

  const dedicatedWithdrawal = Math.max(0, goalCost) - remaining;
  return {
    draws,
    dedicatedWithdrawal,
    shortfall: remaining,
    ordinaryIncome,
    capitalGains,
    earlyWithdrawalPenalty,
  };
}
