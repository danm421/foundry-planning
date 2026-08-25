// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EducationReportPanel } from "../education-report-panel";
import type { ProjectionYear } from "@/engine/types";

const years = [
  { year: 2033, educationGoals: [{ goalId: "edu", dedicatedAssetsBOY: 30000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 30000, dedicatedAssetsEOY: 0, shortfall: 10000 }] } as ProjectionYear,
];

describe("EducationReportPanel", () => {
  it("renders a section per goal with the goal name + KPIs", () => {
    render(<EducationReportPanel years={years} expenses={[{ id: "edu", name: "College for Child" }]} />);
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
      { year: 2033, educationGoals: [{ goalId: "edu", dedicatedAssetsBOY: 40000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 39999, dedicatedAssetsEOY: 0, shortfall: 1 }] } as ProjectionYear,
    ];
    const { unmount } = render(<EducationReportPanel years={nearlyFunded} expenses={[{ id: "edu", name: "College" }]} />);
    expect(screen.getByText("99%")).toBeTruthy();
    unmount();

    const funded = [
      { year: 2033, educationGoals: [{ goalId: "edu", dedicatedAssetsBOY: 40000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 40000, dedicatedAssetsEOY: 0, shortfall: 0 }] } as ProjectionYear,
    ];
    render(<EducationReportPanel years={funded} expenses={[{ id: "edu", name: "College" }]} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("renders an empty state when there are no education goals", () => {
    render(<EducationReportPanel years={[{ year: 2026 } as ProjectionYear]} expenses={[]} />);
    expect(screen.getByText(/No education goals/i)).toBeTruthy();
  });
});
