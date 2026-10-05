// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalsReportPanel } from "../goals-report-panel";
import type { ProjectionYear } from "@/engine/types";

// Every projection year carries `expenses.bySource`; the cash-flow goal builder
// reads it for each year, so the fixture does too.
const years = [
  { year: 2033, expenses: { bySource: {} }, goals: [{ goalId: "edu", dedicatedAssetsBOY: 30000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 30000, dedicatedAssetsEOY: 0, shortfall: 10000 }] } as ProjectionYear,
];

describe("GoalsReportPanel", () => {
  it("renders a section per goal with the goal name + KPIs", () => {
    render(<GoalsReportPanel years={years} expenses={[{ id: "edu", name: "College for Child", type: "education" }]} />);
    expect(screen.getByText("College for Child")).toBeTruthy();
    expect(screen.getByText(/Dedicated Funds Used/i)).toBeTruthy();
    // The gauge measures ONE goal here, not the whole plan.
    expect(screen.getByText("Goal Confidence")).toBeTruthy();
    // 30k of a 40k goal funded — the KPI is a percentage, not shortfall dollars.
    expect(screen.getByText("% Funded")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    // The KPI strip no longer carries shortfall dollars — only the year table does.
    const kpiStrip = screen.getByRole("heading", { name: "College for Child" }).parentElement!;
    expect(kpiStrip.textContent).not.toMatch(/Shortfall/i);
  });

  it("reads 100% only when nothing is unfunded, and rounds down otherwise", () => {
    const nearlyFunded = [
      { year: 2033, goals: [{ goalId: "edu", dedicatedAssetsBOY: 40000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 39999, dedicatedAssetsEOY: 0, shortfall: 1 }] } as ProjectionYear,
    ];
    const { unmount } = render(<GoalsReportPanel years={nearlyFunded} expenses={[{ id: "edu", name: "College", type: "education" }]} />);
    expect(screen.getByText("99%")).toBeTruthy();
    unmount();

    const funded = [
      { year: 2033, goals: [{ goalId: "edu", dedicatedAssetsBOY: 40000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 40000, dedicatedAssetsEOY: 0, shortfall: 0 }] } as ProjectionYear,
    ];
    render(<GoalsReportPanel years={funded} expenses={[{ id: "edu", name: "College", type: "education" }]} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("renders an empty state when there are no goals", () => {
    render(<GoalsReportPanel years={[{ year: 2026 } as ProjectionYear]} expenses={[]} />);
    expect(screen.getByText("No goals yet. Add one on the Goals tab.")).toBeTruthy();
  });

  it("lists an Other goal paid from cash flow at the year's coverage, by start year", () => {
    const cashFlowYear = {
      year: 2029,
      expenses: { bySource: { car: 60000 } },
      income: { socialSecurity: 0, salaries: 50000, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
      withdrawals: { byAccount: {}, total: 0 },
      accountLedgers: {},
      totalExpenses: 100000,
    } as unknown as ProjectionYear;
    render(
      <GoalsReportPanel
        years={[cashFlowYear, ...years]}
        expenses={[
          { id: "edu", name: "College for Child", type: "education" },
          { id: "car", name: "New car", type: "other", isGoal: true },
        ]}
      />,
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["New car", "College for Child"]); // 2029 before 2033
    expect(screen.getByText("Paid from cash flow")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("reads a cash-flow goal in a year the plan funds exactly as 100%, not 99%", () => {
    // Withdrawals fill a deficit year to the dollar, but the two sums behind
    // coverage are floats, so the year lands a hair short of 1 (see
    // `isMaterialShortfall`). That residue is not an unfunded goal.
    const exactlyFunded = {
      year: 2029,
      expenses: { bySource: { car: 60000 } },
      income: { socialSecurity: 0, salaries: 50000, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
      withdrawals: { byAccount: {}, total: 49999.9999999 },
      accountLedgers: {},
      totalExpenses: 100000,
    } as unknown as ProjectionYear;
    render(
      <GoalsReportPanel
        years={[exactlyFunded]}
        expenses={[{ id: "car", name: "New car", type: "other", isGoal: true }]}
      />,
    );
    const pct = screen.getByText("100%");
    expect(pct.className).toContain("text-ink");
    expect(pct.className).not.toContain("text-warn");
  });

  it("leaves out an Other goal its owner pays: no goal rows and no household expense line", () => {
    // A business- or entity-owned goal is not funded (`isFundedGoal`) and never
    // reaches the household's `bySource`, so it has nothing to report.
    render(
      <GoalsReportPanel
        years={[{ year: 2029, expenses: { bySource: {} } } as unknown as ProjectionYear]}
        expenses={[{ id: "boat", name: "Company boat", type: "other", isGoal: true }]}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("No goals yet. Add one on the Goals tab.")).toBeTruthy();
  });
});
