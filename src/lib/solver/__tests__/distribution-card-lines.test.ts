import { describe, it, expect } from "vitest";
import {
  DISTRIBUTIONS_DEPLETED_NOTE,
  distributionCardLines,
  moneyOrDash,
  signedMoney,
} from "../distribution-card-lines";
import type { DistributionRow } from "../monthly-distributions";

type Over = {
  need?: Partial<DistributionRow["need"]>;
  parts?: Partial<DistributionRow["fromAccounts"]["parts"]>;
  from?: Partial<Omit<DistributionRow["fromAccounts"], "parts">>;
} & Partial<Omit<DistributionRow, "need" | "fromAccounts">>;

function row({ need, parts, from, ...over }: Over = {}): DistributionRow {
  return {
    year: 2040,
    ageLabel: "Age 70 / 68",
    retired: true,
    depleted: false,
    need: {
      living: 6_200,
      liabilities: 1_850,
      realEstate: 1_300,
      insurance: 650,
      goalLines: [],
      other: 0,
      savings: 0,
      total: 10_000,
      ...need,
    },
    income: { total: 3_000, sources: [{ label: "Social Security", amount: 3_000 }] },
    taxes: 1_800,
    fromAccounts: {
      total: 8_800,
      accounts: [
        { accountId: "ira", name: "Rollover IRA", amount: 5_200, annualNominal: 62_400, borrowed: 0 },
        { accountId: "brk", name: "Joint Brokerage", amount: 3_600, annualNominal: 43_200, borrowed: 0 },
      ],
      parts: {
        spending: 7_000,
        taxes: 1_800,
        goalShortfall: 0,
        surplusSpent: 0,
        absorbedExtra: 0,
        keptOrReinvested: 0,
        ...parts,
      },
      unexplained: 0,
      ...from,
    },
    goals: [],
    qcds: [],
    lifeInsuranceProceeds: 0,
    ...over,
  };
}

describe("distributionCardLines", () => {
  it("lists the need's non-zero parts in order, goals by name, under one threshold", () => {
    const card = distributionCardLines(
      row({
        need: {
          insurance: 0.49,
          other: 0.5,
          goalLines: [{ expenseId: "car", name: "New car", amount: 2_000 }],
        },
      }),
    );
    expect(card.needLines).toEqual([
      { label: "Living expenses", amount: 6_200 },
      { label: "Debt payments", amount: 1_850 },
      { label: "Real estate", amount: 1_300 },
      { label: "New car (goal)", amount: 2_000 },
      { label: "Other expenses", amount: 0.5 },
    ]);
  });

  it("names the income sources in parentheses, and none when there are none", () => {
    const two = row({
      income: {
        total: 4_000,
        sources: [
          { label: "Social Security", amount: 3_000 },
          { label: "Annuity", amount: 1_000 },
        ],
      },
    });
    expect(distributionCardLines(two).coveredByIncome).toEqual({
      label: "Covered by income",
      sources: "(Social Security, Annuity)",
    });
    const none = row({ income: { total: 0, sources: [] } });
    expect(distributionCardLines(none).coveredByIncome.sources).toBeNull();
  });

  it("spells out what the account money paid for, in the order income is used up", () => {
    const card = distributionCardLines(
      row({ parts: { keptOrReinvested: 700, goalShortfall: 0.4, absorbedExtra: 0.5 } }),
    );
    expect(card.madeOf.map((p) => p.label)).toEqual([
      "spending",
      "taxes",
      "extra spending (whatever's left)",
      "more than needed — reinvested / kept in cash",
    ]);
    expect(card.madeOfText).toBe(
      "$7,000 spending + $1,800 taxes + $1 extra spending (whatever's left) + $700 more than needed — reinvested / kept in cash",
    );
  });

  it("gives the leftover its own line only from a dollar a month", () => {
    expect(distributionCardLines(row({ from: { unexplained: 0.99 } })).unexplained).toBeNull();
    expect(distributionCardLines(row({ from: { unexplained: -1 } })).unexplained).toBe(-1);
    expect(signedMoney(5)).toBe("+$5");
    expect(signedMoney(-8_800)).toBe("−$8,800");
  });

  it("labels margin borrowing and words a QCD note", () => {
    const card = distributionCardLines(
      row({
        from: {
          accounts: [
            { accountId: "brk", name: "Schwab Brokerage", amount: 900, annualNominal: 10_800, borrowed: 400 },
          ],
        },
        qcds: [{ accountId: "ira", name: "Rollover IRA", amount: 400 }],
      }),
    );
    expect(card.accounts).toEqual([
      { accountId: "brk", name: "Schwab Brokerage", note: "(borrowed on margin)", amount: 900 },
    ]);
    expect(card.qcdNotes).toEqual([
      "Also from Rollover IRA: $400/mo straight to charity (QCD), not in the totals above",
    ]);
  });

  it("words the goals box: set-aside accounts, the general-account part and the unfunded part", () => {
    const card = distributionCardLines(
      row({
        goals: [
          {
            goalId: "travel",
            name: "Travel",
            setAsideAccountNames: ["Travel Savings", "Old CD"],
            fromSetAside: 1_250,
            fromGeneral: 300,
            unfunded: 0.4,
          },
          // R14: no set-aside account — here only for what went unfunded.
          {
            goalId: "college",
            name: "Grandkid college",
            setAsideAccountNames: [],
            fromSetAside: 0,
            fromGeneral: 0,
            unfunded: 3_000,
          },
        ],
      }),
    );
    expect(card.goalsCaption).toBe("Not part of the $10,000 or the $8,800");
    expect(card.goals).toEqual([
      {
        goalId: "travel",
        name: "Travel",
        from: "← Travel Savings, Old CD",
        amount: 1_250,
        fromGeneral: { label: "from general accounts — included in the account draws above", amount: 300 },
        shortBy: null,
      },
      {
        goalId: "college",
        name: "Grandkid college",
        from: null,
        amount: null,
        fromGeneral: null,
        shortBy: "short by $3,000",
      },
    ]);
  });

  it("notes life insurance proceeds once, outside the figures", () => {
    expect(distributionCardLines(row()).lifeInsuranceNote).toBeNull();
    expect(distributionCardLines(row({ lifeInsuranceProceeds: 1_000_000 })).lifeInsuranceNote).toBe(
      "Life insurance proceeds of $1,000,000 received this year — not in the monthly figures.",
    );
  });

  describe("the depleted banner names the figure that is money that does not exist", () => {
    it("is absent in a year the accounts last", () => {
      expect(distributionCardLines(row()).depletedBanner).toBeNull();
    });

    it("points at the leftover when the overdraft is no account's draw", () => {
      const card = distributionCardLines(
        row({ depleted: true, from: { total: 0, accounts: [], unexplained: -6_250 } }),
      );
      expect(card.depletedBanner).toBe(
        "† The accounts are exhausted this year. The $6,250 not accounted for is spending paid from an overdrawn account — money that does not exist.",
      );
    });

    it("points at the total from accounts when the overdraft is inside an account's draw", () => {
      const card = distributionCardLines(row({ depleted: true }));
      expect(card.depletedBanner).toBe(
        "† The accounts are exhausted this year. Part of the $8,800 from accounts is drawn from an overdrawn account — money that does not exist.",
      );
    });

    it("says only what is true when neither figure carries it", () => {
      const card = distributionCardLines(
        row({ depleted: true, from: { total: 0, accounts: [], unexplained: 0 } }),
      );
      expect(card.depletedBanner).toBe(
        "† The accounts are exhausted this year. The plan is spending from an overdrawn account.",
      );
    });
  });
});

describe("table cells and the † note", () => {
  it("dashes a cell that would print as $0", () => {
    expect(moneyOrDash(undefined)).toBe("—");
    expect(moneyOrDash(0.49)).toBe("—");
    expect(moneyOrDash(0.5)).toBe("$1");
    expect(moneyOrDash(18_192)).toBe("$18,192");
  });

  it("explains the † without pointing at a single figure", () => {
    expect(DISTRIBUTIONS_DEPLETED_NOTE).toMatch(/^A year marked † is one where the accounts are exhausted\./);
    expect(DISTRIBUTIONS_DEPLETED_NOTE).not.toMatch(/that year's figure/);
  });
});
