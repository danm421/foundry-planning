// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToastProvider } from "../toast";
import { UnifiedClientsTable, type UnifiedClientRow } from "../unified-clients-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams(),
}));

const ROWS: UnifiedClientRow[] = [
  {
    householdId: "H1",
    name: "Smith Household",
    status: "active",
    primaryName: "John Smith",
    spouseName: "Jane Smith",
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
  it("conveys plan state once, through the quick link", () => {
    renderTable(ROWS);
    const planningRow = screen.getByText("Smith Household").closest("tr")!;
    // The quick link is the ONLY "Planning" in the row — the duplicate status
    // pill column it used to sit beside was removed to keep the table on one
    // screen. A second match means that column crept back.
    const planningEls = within(planningRow).getAllByText("Planning");
    expect(planningEls).toHaveLength(1);
    expect(planningEls[0].tagName).toBe("A");
  });

  it("makes the household name the row's primary link", () => {
    renderTable(ROWS);
    // A plan exists → the name opens it. Advisors click the NAME to reach a
    // client's financials; before this it was inert text.
    expect(screen.getByRole("link", { name: "Smith Household" })).toHaveAttribute(
      "href",
      "/clients/C1/details",
    );
    // No plan yet → the CRM record, never the quick-create wizard. Clicking a
    // name must not start a create flow.
    expect(screen.getByRole("link", { name: "Jones Household" })).toHaveAttribute(
      "href",
      "/crm/households/H2",
    );
  });

  it("underlines the name without waiting for a hover", () => {
    renderTable(ROWS);
    const cls = screen.getByRole("link", { name: "Smith Household" }).className;
    // A `hover:`-only affordance is the bug: there is nothing to see until the
    // pointer is already on the target.
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
    expect(cls).toContain("decoration-ink-3");
  });

  it("leaves a trashed household's name unlinked", () => {
    renderTable([{ ...ROWS[0], deletedAt: "2026-05-03T00:00:00.000Z" }]);
    expect(screen.queryByRole("link", { name: "Smith Household" })).toBeNull();
    expect(screen.getByText("Smith Household")).toBeInTheDocument();
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
