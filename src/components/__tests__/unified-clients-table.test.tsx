// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UnifiedClientsTable, type UnifiedClientRow } from "../unified-clients-table";

const ROWS: UnifiedClientRow[] = [
  {
    householdId: "H1",
    name: "Smith Household",
    status: "active",
    primaryName: "John Smith",
    spouseName: "Jane Smith",
    hasPlanning: true,
    planningClientId: "C1",
    updatedAt: "2026-05-01T00:00:00.000Z",
  },
  {
    householdId: "H2",
    name: "Jones Household",
    status: "prospect",
    primaryName: null,
    spouseName: null,
    hasPlanning: false,
    planningClientId: null,
    updatedAt: "2026-05-02T00:00:00.000Z",
  },
];

describe("UnifiedClientsTable", () => {
  it("renders a Planning pill for households with a plan", () => {
    render(<UnifiedClientsTable rows={ROWS} />);
    const planningRow = screen.getByText("Smith Household").closest("tr")!;
    expect(within(planningRow).getByText("Planning")).toBeInTheDocument();
  });

  it("shows an em dash for households with no plan and no primary contact", () => {
    render(<UnifiedClientsTable rows={ROWS} />);
    const prospectRow = screen.getByText("Jones Household").closest("tr")!;
    // No "Planning" pill, and primary-contact cell shows the dash.
    expect(within(prospectRow).queryByText("Planning")).toBeNull();
    expect(within(prospectRow).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders each name as a menu trigger button", () => {
    render(<UnifiedClientsTable rows={ROWS} />);
    expect(screen.getByRole("button", { name: "Smith Household" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jones Household" })).toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    render(<UnifiedClientsTable rows={[]} />);
    expect(screen.getByText(/no clients yet/i)).toBeInTheDocument();
  });
});
