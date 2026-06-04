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
    deletedAt: null,
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
    deletedAt: null,
  },
];

describe("UnifiedClientsTable", () => {
  it("renders a Planning status pill for households with a plan", () => {
    render(<UnifiedClientsTable rows={ROWS} />);
    const planningRow = screen.getByText("Smith Household").closest("tr")!;
    // The row also has a "Planning" quick-link <a>; the status pill is the <span>.
    const planningEls = within(planningRow).getAllByText("Planning");
    expect(planningEls.some((el) => el.tagName === "SPAN")).toBe(true);
  });

  it("shows an em dash for households with no plan and no primary contact", () => {
    render(<UnifiedClientsTable rows={ROWS} />);
    const prospectRow = screen.getByText("Jones Household").closest("tr")!;
    // No "Planning" pill, and primary-contact cell shows the dash.
    expect(within(prospectRow).queryByText("Planning")).toBeNull();
    expect(within(prospectRow).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders CRM and planning quick links per household", () => {
    render(<UnifiedClientsTable rows={ROWS} />);
    const smithRow = screen.getByText("Smith Household").closest("tr")!;
    expect(within(smithRow).getByRole("link", { name: "CRM" })).toBeInTheDocument();
    expect(within(smithRow).getByRole("link", { name: "Planning" })).toBeInTheDocument();
    // Households without a plan get a "Start planning" deep-link instead.
    const jonesRow = screen.getByText("Jones Household").closest("tr")!;
    expect(within(jonesRow).getByRole("link", { name: "CRM" })).toBeInTheDocument();
    expect(within(jonesRow).getByRole("link", { name: "Start planning" })).toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    render(<UnifiedClientsTable rows={[]} />);
    expect(screen.getByText(/no clients yet/i)).toBeInTheDocument();
  });
});
