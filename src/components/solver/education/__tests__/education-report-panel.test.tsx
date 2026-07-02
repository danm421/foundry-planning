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
    // "Shortfall" appears both as the KPI label and as the table's column
    // header — assert presence rather than uniqueness.
    expect(screen.getAllByText(/Shortfall/i).length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no education goals", () => {
    render(<EducationReportPanel years={[{ year: 2026 } as ProjectionYear]} expenses={[]} />);
    expect(screen.getByText(/No education goals/i)).toBeTruthy();
  });
});
