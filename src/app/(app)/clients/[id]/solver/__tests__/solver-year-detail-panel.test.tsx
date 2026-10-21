// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { SolverYearDetailPanel, type YearDetailEditing } from "../solver-year-detail-panel";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import type { DetailTypeKey } from "@/lib/scenario/plan-detail-catalog";

// Reuse the same minimal factories as the helper test.
import type { ClientData, ProjectionYear } from "@/engine";

// Stand-in for the Changes tab's editor host: shows what it was asked to open
// and exposes its two callbacks. The host itself is covered by the Changes tab tests.
vi.mock("../solver-change-editor", () => ({
  SolverChangeEditor: ({
    scenarioId,
    target,
    label,
    onDone,
    onWrite,
  }: {
    scenarioId: string | null;
    target: { page: string; focus: unknown };
    label: string;
    onDone: () => void;
    onWrite?: (e: { targetKind: string; targetId: string; op: string }) => void;
  }) => (
    <div data-testid="editor" data-scenario={scenarioId ?? "base"} data-page={target.page} data-focus={JSON.stringify(target.focus)}>
      {label}
      <button type="button" onClick={() => onWrite?.({ targetKind: "income", targetId: "inc-pen", op: "edit" })}>
        stub write
      </button>
      <button type="button" onClick={onDone}>
        stub close
      </button>
    </div>
  ),
}));

function makeYear(): ProjectionYear {
  return {
    year: 2034,
    ages: { client: 67, spouse: 65 },
    income: { salaries: 0, socialSecurity: 40_000, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 70_000, bySource: { "inc-ss": 40_000, "inc-pen": 30_000 } },
    withdrawals: { byAccount: { "acc-brokerage": 20_000 }, total: 20_000 },
    accountLedgers: { "acc-ira": { rmdAmount: 15_000 } as never },
    expenses: { living: 60_000, liabilities: 12_000, other: 0, insurance: 0, realEstate: 0, taxes: 9_000, cashGifts: 0, discretionary: 0, total: 81_000, bySource: {}, byLiability: { "liab-mortgage": 12_000 }, interestByLiability: {} },
    savings: { byAccount: { "acc-401k": 10_000 }, total: 10_000, employerTotal: 0 },
    totalIncome: 105_000, totalExpenses: 91_000, netCashFlow: 14_000,
    portfolioAssets: { taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {}, stockOptions: {}, taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0, businessTotal: 0, lifeInsuranceTotal: 0, stockOptionsTotal: 0, trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0, accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0, total: 1_000_000, liquidTotal: 800_000 },
  } as unknown as ProjectionYear;
}
function makeClientData(): ClientData {
  return {
    client: { firstName: "A", lastName: "B" },
    incomes: [ { id: "inc-ss", name: "Social Security", type: "social_security" }, { id: "inc-pen", name: "Pension", type: "deferred" } ],
    entities: [], accounts: [ { id: "acc-ira", name: "Traditional IRA", category: "retirement", owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }] }, { id: "acc-brokerage", name: "Joint Brokerage", category: "taxable", owners: [] }, { id: "acc-401k", name: "401(k)", category: "retirement", owners: [] } ],
    liabilities: [{ id: "liab-mortgage", name: "Home Mortgage" }], expenses: [], assetTransactions: [], stockOptionPlans: [], notesReceivable: [], medicareCoverage: [],
  } as unknown as ClientData;
}

describe("SolverYearDetailPanel", () => {
  it("renders the year/age header and both column headings", () => {
    render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} />);
    expect(screen.getByText("2034")).toBeInTheDocument();
    expect(screen.getByText("Age 67 / 65")).toBeInTheDocument();
    expect(screen.getByText("Inflows")).toBeInTheDocument();
    expect(screen.getByText("Outflows")).toBeInTheDocument();
  });

  it("lists the inflows in the chart's order, each with its bar's color", () => {
    render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} />);
    const swatchOf = (name: string) =>
      screen.getByRole("rowheader", { name: new RegExp(`^${name}`) }).querySelector("[style]")?.getAttribute("style");
    expect(swatchOf("Social Security")).toContain("var(--data-blue)");
    expect(swatchOf("Other Inflows")).toContain("var(--data-teal)");
    expect(swatchOf("RMDs")).toContain("var(--data-orange)");
    expect(swatchOf("Portfolio Withdrawals")).toContain("var(--data-yellow)");
    // Outflow categories have no bar on the chart, so no swatch color.
    expect(swatchOf("Living Expenses")).toBeUndefined();
    // …but a neutral marker still sets the category row apart from its items.
    expect(
      screen.getByRole("rowheader", { name: /^Living Expenses/ }).querySelector(".bg-ink-4"),
    ).not.toBeNull();
  });

  it("shows every category's items by default and collapses on click", () => {
    render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} />);
    expect(screen.getByText("Pension")).toBeInTheDocument();
    expect(screen.getByText("Home Mortgage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Other Inflows/ }));
    expect(screen.queryByText("Pension")).not.toBeInTheDocument();
    expect(screen.getByText("Home Mortgage")).toBeInTheDocument();
  });

  it("renders the net cash flow with a positive tone when in surplus", () => {
    render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} />);
    const net = screen.getByTestId("year-detail-net");
    expect(within(net).getByText(/\$14,000/)).toBeInTheDocument();
    expect(net.className).toContain("text-good");
  });

  it("shows the Withdrawal % beside net cash flow in a year that draws on the portfolio", () => {
    const year = makeYear();
    // 20k drawn + 15k RMD against last year's 1M ending portfolio. This year's
    // own 800k would read 4.38%.
    const prior = {
      ...year,
      year: 2033,
      portfolioAssets: { ...year.portfolioAssets, liquidTotal: 1_000_000 },
    } as ProjectionYear;
    render(<SolverYearDetailPanel year={year} years={[prior, year]} clientData={makeClientData()} />);
    expect(screen.getByTestId("year-detail-withdrawal-rate")).toHaveTextContent("3.50%");
  });

  it("shows the Withdrawal % in a year whose only draw is an RMD", () => {
    const year = { ...makeYear(), withdrawals: { byAccount: {}, total: 0 } } as ProjectionYear;
    const prior = {
      ...year,
      year: 2033,
      portfolioAssets: { ...year.portfolioAssets, liquidTotal: 1_000_000 },
    } as ProjectionYear;
    render(<SolverYearDetailPanel year={year} years={[prior, year]} clientData={makeClientData()} />);
    // The 15k RMD alone against last year's 1M.
    expect(screen.getByTestId("year-detail-withdrawal-rate")).toHaveTextContent("1.50%");
  });

  it("shows a QCDs figure and counts it in the Withdrawal % only in a year with a QCD", () => {
    const base = makeYear();
    const prior = {
      ...base,
      year: 2033,
      portfolioAssets: { ...base.portfolioAssets, liquidTotal: 1_000_000 },
    } as ProjectionYear;
    render(<SolverYearDetailPanel year={base} years={[prior, base]} clientData={makeClientData()} />);
    expect(screen.queryByTestId("year-detail-qcd")).not.toBeInTheDocument();
    cleanup();

    const year = {
      ...base,
      accountLedgers: { "acc-ira": { rmdAmount: 15_000, qcdAmount: 10_000 } as never },
    } as ProjectionYear;
    render(<SolverYearDetailPanel year={year} years={[prior, year]} clientData={makeClientData()} />);
    expect(screen.getByTestId("year-detail-qcd")).toHaveTextContent("$10,000");
    // (20k draw + 15k RMD + 10k QCD) / 1M
    expect(screen.getByTestId("year-detail-withdrawal-rate")).toHaveTextContent("4.50%");
  });

  it("leaves the Withdrawal % out when nothing is drawn from the portfolio", () => {
    const year = {
      ...makeYear(),
      withdrawals: { byAccount: {}, total: 0 },
      accountLedgers: {},
    } as unknown as ProjectionYear;
    render(<SolverYearDetailPanel year={year} years={[year]} clientData={makeClientData()} />);
    expect(screen.queryByTestId("year-detail-withdrawal-rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Withdrawal %")).not.toBeInTheDocument();
  });

  describe("editing a line item", () => {
    const item = (typeKey: DetailTypeKey, id: string, label: string): InventoryItem => ({
      key: `${typeKey}:${id}`, typeKey, id, label, canEdit: true, canDelete: true,
    });
    const inventory = [
      item("social_security", "inc-ss", "Social Security"),
      item("income", "inc-pen", "Pension"),
      item("liability", "liab-mortgage", "Home Mortgage"),
      item("account", "acc-brokerage", "Joint Brokerage"),
    ];
    const onTargetsWritten = vi.fn();
    const editing = (scenarioId: string | null): YearDetailEditing => ({
      clientId: "c1", scenarioId, inventory, onTargetsWritten,
    });

    beforeEach(() => {
      onTargetsWritten.mockReset();
    });

    it("opens a clicked item's editor in the scenario and closes it when done", () => {
      render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} editing={editing("s1")} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit Home Mortgage" }));
      const editor = screen.getByTestId("editor");
      expect(editor.dataset.scenario).toBe("s1");
      expect(editor.dataset.page).toBe("net-worth");
      expect(JSON.parse(editor.dataset.focus!)).toEqual({ intent: "edit", kind: "liability", id: "liab-mortgage" });
      expect(editor).toHaveTextContent("Home Mortgage");

      fireEvent.click(screen.getByRole("button", { name: "stub close" }));
      expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
    });

    it("reports the editor's writes so replaced Solver levers drop", () => {
      render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} editing={editing("s1")} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit Pension" }));
      fireEvent.click(screen.getByRole("button", { name: "stub write" }));
      expect(onTargetsWritten).toHaveBeenCalledWith(
        [{ targetKind: "income", targetId: "inc-pen", op: "edit" }],
        "Pension",
      );
    });

    it("lets a category with no item rows open the one item it stands for", () => {
      render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} editing={editing("s1")} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit Social Security" }));
      expect(JSON.parse(screen.getByTestId("editor").dataset.focus!)).toEqual({
        intent: "edit", kind: "income", id: "inc-ss",
      });
    });

    it("keeps rows with nothing to edit as plain text", () => {
      render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} editing={editing("s1")} />);
      // Not in the inventory (the test plan never saved it).
      expect(screen.getByText("Traditional IRA").closest("button")).toBeNull();
      // Savings with no rule behind it.
      expect(screen.getByText("401(k)").closest("button")).toBeNull();
    });

    it("on the base case, opens the same editor with no scenario, and reports its writes", () => {
      render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} editing={editing(null)} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit Pension" }));
      const editor = screen.getByTestId("editor");
      expect(editor.dataset.scenario).toBe("base");
      expect(JSON.parse(editor.dataset.focus!)).toEqual({ intent: "edit", kind: "income", id: "inc-pen" });

      fireEvent.click(screen.getByRole("button", { name: "stub write" }));
      expect(onTargetsWritten).toHaveBeenCalledWith(
        [{ targetKind: "income", targetId: "inc-pen", op: "edit" }],
        "Pension",
      );
    });

    it("leaves every name plain for an advisor who can't edit", () => {
      render(<SolverYearDetailPanel year={makeYear()} years={[]} clientData={makeClientData()} />);
      expect(screen.getByText("Pension").closest("button")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    });
  });
});
