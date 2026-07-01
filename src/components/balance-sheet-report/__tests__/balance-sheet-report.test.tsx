// @vitest-environment jsdom
// src/components/balance-sheet-report/__tests__/balance-sheet-report.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FamilyMember } from "@/engine/types";

// The summary panel renders a Chart.js Pie; stub it so jsdom never touches <canvas>.
vi.mock("react-chartjs-2", () => ({ Pie: () => <div data-testid="pie" /> }));

import BalanceSheetReport, { type BalanceSheetReportProps } from "../balance-sheet-report";

const familyMembers: FamilyMember[] = [
  { id: "c", role: "client", relationship: "child", firstName: "John", lastName: null, dateOfBirth: null },
];

function makeYear(year: number, cash: number): BalanceSheetReportProps["projectionYears"][number] {
  return {
    year,
    portfolioAssets: { cash: {}, taxable: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {}, total: 0 },
    accountLedgers: { a1: { beginningValue: cash, endingValue: cash } },
    liabilityBalancesBoY: {},
  } as BalanceSheetReportProps["projectionYears"][number];
}

const props: BalanceSheetReportProps = {
  accounts: [{ id: "a1", name: "Checking", category: "cash", owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }] }],
  liabilities: [],
  entities: [],
  notesReceivable: [],
  familyMembers,
  projectionYears: [makeYear(2026, 100_000), makeYear(2031, 150_000)],
  selectableYears: [2026, 2031],
  defaultYear: 2026,
  clientLabel: "John",
  spouseLabel: null,
};

describe("BalanceSheetReport", () => {
  it("has no add/edit affordances", () => {
    render(<BalanceSheetReport {...props} />);
    expect(screen.queryByText(/add asset/i)).toBeNull();
    expect(screen.queryByText(/^edit$/i)).toBeNull();
    expect(screen.queryByText(/add liability/i)).toBeNull();
  });

  it("hides spouse and joint columns for a single-client household", () => {
    render(<BalanceSheetReport {...props} />);
    expect(screen.queryByRole("columnheader", { name: "Joint" })).toBeNull();
  });

  it("re-renders the snapshot when the year changes", () => {
    render(<BalanceSheetReport {...props} />);
    expect(screen.getAllByText("$100,000").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2031" } });
    expect(screen.getAllByText("$150,000").length).toBeGreaterThan(0);
  });

  it("switches to the By Entity tab", () => {
    render(<BalanceSheetReport {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "By Entity" }));
    expect(screen.getByText(/no business or trust entities/i)).toBeInTheDocument();
  });
});
