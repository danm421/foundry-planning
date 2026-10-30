// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SolverMonthlyDistributionsPanel } from "../solver-monthly-distributions-panel";
import { MonthlyModeSwitch } from "../solver-monthly-mode-switch";
import { SolverMonthlyCashFlowPanel } from "../solver-monthly-cash-flow-panel";
import type { MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";
import type { DistributionRow } from "@/lib/solver/monthly-distributions";

const noop = () => {};

function drow(
  year: number,
  over: Partial<DistributionRow> = {},
): DistributionRow {
  return {
    year,
    ageLabel: "Age 68 / 66",
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
    },
    income: {
      total: 3_000,
      sources: [{ label: "Social Security", amount: 3_000 }],
    },
    taxes: 1_800,
    fromAccounts: {
      total: 8_800,
      accounts: [
        { accountId: "a1", name: "Rollover IRA", amount: 5_200, borrowed: 0 },
        {
          accountId: "a2",
          name: "Joint Brokerage",
          amount: 3_600,
          borrowed: 0,
        },
      ],
      parts: {
        spending: 7_000,
        taxes: 1_800,
        goalShortfall: 0,
        surplusSpent: 0,
        absorbedExtra: 0,
        keptOrReinvested: 0,
      },
      unexplained: 0,
    },
    goals: [
      {
        goalId: "g1",
        name: "Travel",
        setAsideAccountNames: ["Travel Savings"],
        fromSetAside: 1_250,
        fromGeneral: 0,
        unfunded: 0,
      },
    ],
    qcds: [],
    ...over,
  };
}

function cfRow(
  year: number,
  over: Partial<MonthlyCashFlowRow> = {},
): MonthlyCashFlowRow {
  return {
    year,
    ageLabel: "Age 68 / 66",
    income: 3_000,
    fixed: {
      taxes: 1_800,
      liabilities: 0,
      savings: 0,
      insurance: 0,
      realEstate: 0,
      other: 0,
      total: 10_000,
    },
    leftAfterFixed: -7_000,
    portfolioDraw: 7_000,
    available: 10_000,
    split: {
      living: 10_000,
      surplusSpent: 0,
      surplusUnspent: 0,
      unexplained: 0,
    },
    depleted: false,
    ...over,
  };
}

function setup(rows: DistributionRow[], over: Record<string, unknown> = {}) {
  const onYearClick = vi.fn();
  const utils = render(
    <SolverMonthlyDistributionsPanel
      rows={rows}
      cashFlowRows={rows.map((r) => cfRow(r.year))}
      selectedYear={rows[0].year}
      onYearClick={onYearClick}
      basis="today"
      onBasisChange={noop}
      mode="distributions"
      onModeChange={noop}
      {...over}
    />,
  );
  return { onYearClick, ...utils };
}

describe("SolverMonthlyDistributionsPanel", () => {
  it("captions the year selectMonthlyRow picks", () => {
    // 2031 is the first year income < fixed total when nothing is selected.
    const rows = [drow(2030), drow(2031)];
    const cf = [cfRow(2030, { income: 20_000 }), cfRow(2031)];
    render(
      <SolverMonthlyDistributionsPanel
        rows={rows}
        cashFlowRows={cf}
        selectedYear={null}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
        mode="distributions"
        onModeChange={noop}
      />,
    );
    expect(screen.getByTestId("distributions-year").textContent).toBe("2031");
  });

  it("shows the need and the total from accounts with their captions", () => {
    setup([drow(2027)]);
    const need = screen.getByTestId("distributions-need");
    expect(within(need).getByText("Monthly spending need")).toBeTruthy();
    expect(within(need).getByText("$10,000")).toBeTruthy();
    expect(
      within(need).getByText(
        "Before taxes · not counting goals paid from set-aside accounts",
      ),
    ).toBeTruthy();
    expect(within(need).getByText(/Covered by income/)).toBeTruthy();
    expect(within(need).getByText("From accounts for spending")).toBeTruthy();
    const total = screen.getByTestId("distributions-total");
    expect(
      within(total).getByText("Total from accounts each month"),
    ).toBeTruthy();
    expect(within(total).getByText("$8,800")).toBeTruthy();
    expect(
      within(total).getByText("$7,000 spending + $1,800 taxes"),
    ).toBeTruthy();
  });

  it("says the goals are not part of either figure", () => {
    setup([drow(2027)]);
    const goals = screen.getByTestId("distributions-goals");
    expect(
      within(goals).getByText("Goals — paid from set-aside accounts"),
    ).toBeTruthy();
    expect(
      within(goals).getByText("Not part of the $10,000 or the $8,800"),
    ).toBeTruthy();
    expect(within(goals).getByText(/^Travel/)).toBeTruthy();
  });

  it("keeps the taxes box separate from the need box", () => {
    setup([drow(2027)]);
    const taxes = screen.getByTestId("distributions-taxes");
    expect(screen.getByTestId("distributions-need").contains(taxes)).toBe(
      false,
    );
    expect(within(taxes).getByText("+ Taxes (paid separately)")).toBeTruthy();
    expect(
      within(taxes).getByText("Federal + state, spread evenly across the year"),
    ).toBeTruthy();
  });

  it("gives four accounts their own column and rolls the rest into Other accounts", () => {
    const names = ["A1", "A2", "A3", "A4", "A5", "A6"];
    const accounts = names.map((n, i) => ({
      accountId: n,
      name: `Acct ${n}`,
      amount: 600 - i * 50,
      borrowed: 0,
    }));
    setup([
      drow(2027, {
        fromAccounts: { ...drow(2027).fromAccounts, total: 3_000, accounts },
      }),
    ]);
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());
    expect(headers.filter((h) => h?.startsWith("Acct "))).toEqual([
      "Acct A1",
      "Acct A2",
      "Acct A3",
      "Acct A4",
    ]);
    expect(headers).toContain("Other accounts");
    expect(headers).toContain("Goals (set-aside)");
  });

  it("has no Other accounts column with four or fewer accounts", () => {
    setup([drow(2027)]);
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());
    expect(headers).not.toContain("Other accounts");
  });

  it("calls onYearClick with the row's year", async () => {
    const { onYearClick } = setup([drow(2027), drow(2028)]);
    await userEvent.click(screen.getByTestId("distributions-row-2028"));
    expect(onYearClick).toHaveBeenCalledWith(2028);
  });

  it("flags borrowed money as margin", () => {
    const base = drow(2027);
    setup([
      drow(2027, {
        fromAccounts: {
          ...base.fromAccounts,
          accounts: [
            {
              accountId: "a1",
              name: "Rollover IRA",
              amount: 8_800,
              borrowed: 500,
            },
          ],
        },
      }),
    ]);
    expect(screen.getByText(/borrowed on margin/)).toBeTruthy();
  });

  it("shows the not-accounted-for line only from a dollar a month", () => {
    const base = drow(2027);
    const { unmount } = setup([
      drow(2027, { fromAccounts: { ...base.fromAccounts, unexplained: 0.4 } }),
    ]);
    expect(screen.queryByTestId("distributions-unexplained")).toBeNull();
    unmount();
    setup([
      drow(2027, { fromAccounts: { ...base.fromAccounts, unexplained: 5 } }),
    ]);
    const line = screen.getByTestId("distributions-unexplained");
    expect(within(line).getByText("not accounted for")).toBeTruthy();
    expect(within(line).getByText("+$5")).toBeTruthy();
    expect(screen.getByText("$7,000 spending + $1,800 taxes")).toBeTruthy();
  });

  it("renders a depleted year honestly: signed leftover and a dagger on the total", () => {
    const base = drow(2027);
    setup([
      drow(2027, {
        depleted: true,
        fromAccounts: {
          ...base.fromAccounts,
          total: 0,
          accounts: [],
          unexplained: -8_800,
        },
      }),
    ]);
    const line = screen.getByTestId("distributions-unexplained");
    expect(within(line).getByText("−$8,800")).toBeTruthy();
    expect(
      within(screen.getByTestId("distributions-total")).getByText("†"),
    ).toBeTruthy();
  });

  it("explains a goal's general-account part and its unfunded part", () => {
    const g = drow(2027).goals[0];
    setup([drow(2027, { goals: [{ ...g, fromGeneral: 300, unfunded: 120 }] })]);
    const goals = screen.getByTestId("distributions-goals");
    expect(
      within(goals).getByText(
        "from general accounts — included in the account draws above",
      ),
    ).toBeTruthy();
    expect(within(goals).getByText("short by $120")).toBeTruthy();
  });

  it("notes a QCD as going straight to charity", () => {
    setup([
      drow(2027, {
        qcds: [{ accountId: "a1", name: "Rollover IRA", amount: 400 }],
      }),
    ]);
    expect(
      screen.getByText(
        /Also from Rollover IRA: \$400\/mo straight to charity \(QCD\), not in the totals above/,
      ),
    ).toBeTruthy();
  });

  it("marks only the selected table row", () => {
    setup([drow(2027), drow(2028)], { selectedYear: 2028 });
    expect(
      screen.getByTestId("distributions-row-2028").getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen.getByTestId("distributions-row-2027").getAttribute("aria-current"),
    ).toBeNull();
  });

  it("omits the empty parentheses when income has no sources", () => {
    setup([drow(2027, { income: { total: 0, sources: [] } })]);
    const need = screen.getByTestId("distributions-need");
    expect(
      within(need).getByText(/Covered by income/).textContent,
    ).not.toContain("(");
  });

  it("marks a depleted year with a dagger and the exhausted wording", () => {
    setup([drow(2027, { depleted: true })]);
    expect(
      screen.getByText(/The accounts are exhausted this year/),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("distributions-row-2027")).getByText("†"),
    ).toBeTruthy();
  });
});

describe("MonthlyModeSwitch", () => {
  it("calls onChange with cashflow", async () => {
    const onChange = vi.fn();
    render(<MonthlyModeSwitch mode="distributions" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Cash flow" }));
    expect(onChange).toHaveBeenCalledWith("cashflow");
  });
});

describe("SolverMonthlyCashFlowPanel mode switch", () => {
  const props = {
    rows: [cfRow(2027)],
    selectedYear: 2027,
    onYearClick: noop,
    basis: "today" as const,
    onBasisChange: noop,
  };
  it("renders the switch only when mode is passed", () => {
    const { unmount } = render(<SolverMonthlyCashFlowPanel {...props} />);
    expect(screen.queryByRole("button", { name: "Distributions" })).toBeNull();
    unmount();
    render(
      <SolverMonthlyCashFlowPanel
        {...props}
        mode="cashflow"
        onModeChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Distributions" })).toBeTruthy();
  });
});
