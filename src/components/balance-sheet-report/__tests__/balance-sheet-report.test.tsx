// @vitest-environment jsdom
// src/components/balance-sheet-report/__tests__/balance-sheet-report.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { FamilyMember } from "@/engine/types";

// The summary panel renders a Chart.js Pie; stub it so jsdom never touches <canvas>.
vi.mock("react-chartjs-2", () => ({ Pie: () => <div data-testid="pie" /> }));

import BalanceSheetReport, { type BalanceSheetReportProps } from "../balance-sheet-report";

const familyMembers: FamilyMember[] = [
  { id: "c", role: "client", relationship: "child", firstName: "John", lastName: null, dateOfBirth: null },
];

function makeYear(
  year: number,
  beginning: number,
  ending: number = beginning,
): BalanceSheetReportProps["projectionYears"][number] {
  return {
    year,
    portfolioAssets: { cash: {}, taxable: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {}, total: 0 },
    accountLedgers: { a1: { beginningValue: beginning, endingValue: ending } },
    liabilityBalancesBoY: {},
  } as BalanceSheetReportProps["projectionYears"][number];
}

const props: BalanceSheetReportProps = {
  accounts: [{ id: "a1", name: "Checking", category: "cash", owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }] }],
  liabilities: [],
  entities: [],
  notesReceivable: [],
  familyMembers,
  // First year: beginning (today) 90k, end-of-2026 100k. Second year end 150k.
  projectionYears: [makeYear(2026, 90_000, 100_000), makeYear(2031, 150_000, 150_000)],
  selectableYears: [2026, 2031],
  agesByYear: { 2026: { client: 64 }, 2031: { client: 69 } },
  todayYear: 2026,
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

  it("defaults to Today (first-year beginning values) and re-renders on year change", () => {
    render(<BalanceSheetReport {...props} />);
    // Today shows the first projection year's beginning-of-year value.
    expect(screen.getAllByText("$90,000").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2031" } });
    expect(screen.getAllByText("$150,000").length).toBeGreaterThan(0);
  });

  it("distinguishes Today from the current year's end-of-year projection", () => {
    render(<BalanceSheetReport {...props} />);
    expect(screen.getAllByText("$90,000").length).toBeGreaterThan(0); // Today
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2026" } });
    expect(screen.getAllByText("$100,000").length).toBeGreaterThan(0); // EoY 2026
  });

  it("offers a Today option and annotates years with ages", () => {
    render(<BalanceSheetReport {...props} />);
    expect(screen.getByRole("option", { name: /Today \(2026\) · 64/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2031 · 69" })).toBeInTheDocument();
  });

  it("switches to the By Entity tab", () => {
    render(<BalanceSheetReport {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "By Entity" }));
    expect(screen.getByText(/no business or trust entities/i)).toBeInTheDocument();
  });
});

describe("BalanceSheetReport — Download PDF", () => {
  afterEach(() => vi.unstubAllGlobals());

  function exportQuery() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), blob: async () => new Blob() });
    vi.stubGlobal("fetch", fetchMock);
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => "blob:pdf");
    URL.revokeObjectURL = vi.fn();
    return async () => {
      fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const url = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
      expect(url.pathname).toBe("/api/clients/c1/balance-sheet-report/export-pdf");
      return Object.fromEntries(url.searchParams);
    };
  }

  function renderWithAccess() {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetReport {...props} pdfClientId="c1" />
      </ClientAccessProvider>,
    );
  }

  it("exports the default view: Household as of today", async () => {
    const download = exportQuery();
    renderWithAccess();
    expect(await download()).toEqual({ view: "household", asOf: "today" });
  });

  it("exports the year and tab on screen", async () => {
    const download = exportQuery();
    renderWithAccess();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2031" } });
    fireEvent.click(screen.getByRole("tab", { name: "By Entity" }));
    expect(await download()).toEqual({ view: "entities", asOf: "eoy", year: "2031", filter: "all" });
  });

  it("has no Download PDF button without a client to export (solver preview)", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetReport {...props} />
      </ClientAccessProvider>,
    );
    expect(screen.queryByRole("button", { name: /download pdf/i })).toBeNull();
  });
});
