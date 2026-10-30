// The Distributions year card's wording, ONCE: which lines show, in what
// order, under what threshold and with what words. The screen panel, the
// printed page and the chart tooltip all read `distributionCardLines`, so a
// printed page can't disagree with the screen (spec anti-goal). The figures
// themselves come from `buildMonthlyDistributionRows`; nothing is computed here.
import {
  MIN_LINE_PER_MONTH,
  MIN_UNEXPLAINED_PER_MONTH,
  type DistributionRow,
} from "./monthly-distributions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$8,800" — the card's, the table's and the tooltip's one money format. */
export const money = (v: number) => usd.format(v);

/** "+$5" / "−$8,800": the leftover's sign is part of what it says. */
export const signedMoney = (v: number) => `${v < 0 ? "−" : "+"}${money(Math.abs(v))}`;

/** A table cell: the amount, or "—" where it would print as "$0". */
export const moneyOrDash = (v: number | undefined) =>
  v !== undefined && v >= MIN_LINE_PER_MONTH ? money(v) : "—";

/** The † beside a depleted year, spelled out: the table row's title on screen,
 *  the note under the printed table. */
export const DISTRIBUTIONS_DEPLETED_NOTE =
  "A year marked † is one where the accounts are exhausted. The plan keeps spending from an overdrawn account, so part of that year's money does not exist.";

export const NOT_ACCOUNTED_FOR = "not accounted for";

type PartKey = keyof DistributionRow["fromAccounts"]["parts"];

/** The "made of" parts, in the order income is used up (spec): spending first,
 *  then taxes, then goal shortfall; whatever is left is kept / reinvested. */
const PART_LABELS: [PartKey, string][] = [
  ["spending", "spending"],
  ["taxes", "taxes"],
  ["goalShortfall", "goal shortfall"],
  ["surplusSpent", "extra spending of surplus"],
  ["absorbedExtra", "extra spending (whatever's left)"],
  ["keptOrReinvested", "more than needed — reinvested / kept in cash"],
];

export interface DistributionCardLines {
  /** The depleted year's warning, naming the figure that is money that does
   *  not exist; null in any other year. */
  depletedBanner: string | null;
  /** Life insurance paid this year, said once and kept out of every figure. */
  lifeInsuranceNote: string | null;
  /** Under the spending need: each non-zero part, goal lines by name. */
  needLines: { label: string; amount: number }[];
  /** "Covered by income" plus "(Social Security, Annuity)" — null with no source. */
  coveredByIncome: { label: string; sources: string | null };
  /** Under "Total from accounts": what the account money paid for. */
  madeOf: { label: string; amount: number }[];
  /** `madeOf` as one line: "$7,000 spending + $1,800 taxes". */
  madeOfText: string;
  /** The leftover, when it earns its own line (≥ $1/month); else null. */
  unexplained: number | null;
  accounts: { accountId: string; name: string; note: string | null; amount: number }[];
  qcdNotes: string[];
  /** "Not part of the $X or the $Y" — the two big numbers. */
  goalsCaption: string;
  goals: {
    goalId: string;
    name: string;
    /** "← Travel Savings" — null for a goal with no set-aside account. */
    from: string | null;
    /** The set-aside draw; null for a goal with no set-aside account (listed
     *  only for its "short by"). */
    amount: number | null;
    fromGeneral: { label: string; amount: number } | null;
    shortBy: string | null;
  }[];
}

export function distributionCardLines(r: DistributionRow): DistributionCardLines {
  const { need, fromAccounts: from } = r;
  const shown = (amount: number) => amount >= MIN_LINE_PER_MONTH;

  const madeOf = PART_LABELS.map(([key, label]) => ({ label, amount: from.parts[key] })).filter(
    (p) => shown(p.amount),
  );
  const unexplained = Math.abs(from.unexplained) >= MIN_UNEXPLAINED_PER_MONTH ? from.unexplained : null;

  return {
    depletedBanner: r.depleted ? depletedBanner(from.total, unexplained) : null,
    lifeInsuranceNote: shown(r.lifeInsuranceProceeds)
      ? `Life insurance proceeds of ${money(r.lifeInsuranceProceeds)} received this year — not in the monthly figures.`
      : null,
    needLines: [
      { label: "Living expenses", amount: need.living },
      { label: "Debt payments", amount: need.liabilities },
      { label: "Real estate", amount: need.realEstate },
      { label: "Insurance", amount: need.insurance },
      ...need.goalLines.map((g) => ({ label: `${g.name} (goal)`, amount: g.amount })),
      { label: "Other expenses", amount: need.other },
      { label: "Savings contributions", amount: need.savings },
    ].filter((l) => shown(l.amount)),
    coveredByIncome: {
      label: "Covered by income",
      sources:
        r.income.sources.length > 0 ? `(${r.income.sources.map((s) => s.label).join(", ")})` : null,
    },
    madeOf,
    madeOfText: madeOf.map((p) => `${money(p.amount)} ${p.label}`).join(" + "),
    unexplained,
    accounts: from.accounts.map((a) => ({
      accountId: a.accountId,
      name: a.name,
      note: a.borrowed > 0 ? "(borrowed on margin)" : null,
      amount: a.amount,
    })),
    qcdNotes: r.qcds.map(
      (q) =>
        `Also from ${q.name}: ${money(q.amount)}/mo straight to charity (QCD), not in the totals above`,
    ),
    goalsCaption: `Not part of the ${money(need.total)} or the ${money(from.total)}`,
    goals: r.goals.map((g) => {
      const setAside = g.setAsideAccountNames.length > 0;
      return {
        goalId: g.goalId,
        name: g.name,
        from: setAside ? `← ${g.setAsideAccountNames.join(", ")}` : null,
        amount: setAside ? g.fromSetAside : null,
        fromGeneral: shown(g.fromGeneral)
          ? {
              label: "from general accounts — included in the account draws above",
              amount: g.fromGeneral,
            }
          : null,
        shortBy: shown(g.unfunded) ? `short by ${money(g.unfunded)}` : null,
      };
    }),
  };
}

/** Says WHICH figure is money that does not exist (M9). When the plan
 *  overdraws checking, the overdraft is no account's draw: it is the negative
 *  leftover. When it overdraws the last account it drew from (a plan with no
 *  checking), the overdraft is inside that account's line. */
function depletedBanner(total: number, unexplained: number | null): string {
  const lead = "† The accounts are exhausted this year.";
  if (unexplained != null && unexplained < 0) {
    return `${lead} The ${money(-unexplained)} ${NOT_ACCOUNTED_FOR} is spending paid from an overdrawn account — money that does not exist.`;
  }
  if (total >= MIN_LINE_PER_MONTH) {
    return `${lead} Part of the ${money(total)} from accounts is drawn from an overdrawn account — money that does not exist.`;
  }
  return `${lead} The plan is spending from an overdrawn account.`;
}
