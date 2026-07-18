// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToastProvider } from "../toast";
import { UnifiedClientsTable, type UnifiedClientRow } from "../unified-clients-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

function renderTable(rows: UnifiedClientRow[]) {
  return render(
    <ToastProvider>
      <UnifiedClientsTable rows={rows} />
    </ToastProvider>,
  );
}

describe("UnifiedClientsTable", () => {
  it("renders a Planning status pill for households with a plan", () => {
    renderTable(ROWS);
    const planningRow = screen.getByText("Smith Household").closest("tr")!;
    // The row also has a "Planning" quick-link <a>; the status pill is the <span>.
    const planningEls = within(planningRow).getAllByText("Planning");
    expect(planningEls.some((el) => el.tagName === "SPAN")).toBe(true);
  });

  it("shows an em dash for households with no plan and no primary contact", () => {
    renderTable(ROWS);
    const prospectRow = screen.getByText("Jones Household").closest("tr")!;
    // No "Planning" pill, and primary-contact cell shows the dash.
    expect(within(prospectRow).queryByText("Planning")).toBeNull();
    expect(within(prospectRow).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders CRM and planning quick links per household", () => {
    renderTable(ROWS);
    const smithRow = screen.getByText("Smith Household").closest("tr")!;
    expect(within(smithRow).getByRole("link", { name: "CRM" })).toBeInTheDocument();
    expect(within(smithRow).getByRole("link", { name: "Planning" })).toBeInTheDocument();
    // Households without a plan get a "Start planning" deep-link instead.
    const jonesRow = screen.getByText("Jones Household").closest("tr")!;
    expect(within(jonesRow).getByRole("link", { name: "CRM" })).toBeInTheDocument();
    expect(within(jonesRow).getByRole("link", { name: "Start planning" })).toBeInTheDocument();
  });

  it("renders an inline status dropdown preset to the row's status", () => {
    renderTable(ROWS);
    const smithRow = screen.getByText("Smith Household").closest("tr")!;
    const select = within(smithRow).getByRole("combobox", {
      name: "Status for Smith Household",
    }) as HTMLSelectElement;
    expect(select.value).toBe("active");
  });

  it("renders static status text instead of a dropdown for trashed rows", () => {
    renderTable([
      {
        ...ROWS[0],
        deletedAt: "2026-05-03T00:00:00.000Z",
      },
    ]);
    const row = screen.getByText("Smith Household").closest("tr")!;
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    renderTable([]);
    expect(screen.getByText(/no clients yet/i)).toBeInTheDocument();
  });
});
