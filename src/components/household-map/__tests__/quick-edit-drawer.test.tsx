// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import QuickEditDrawer from "../quick-edit-drawer";
import type { ClientMilestones } from "@/lib/milestones";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/client-1/details/map",
}));

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2066,
  clientRetirement: 2045,
  clientEnd: 2066,
};

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFlowFetch(rows: Record<string, unknown>[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => rows,
  }) as unknown as typeof fetch;
}

function baseExpenseRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "exp-1",
    name: "Expense",
    annualAmount: "10000",
    startYear: 2028,
    endYear: 2030,
    startYearRef: null,
    endYearRef: null,
    growthRate: "0.03",
    growthSource: "custom",
    isGoal: false,
    isDefault: false,
    ...overrides,
  };
}

describe("QuickEditDrawer — goal checkbox (Task 11 brief, Step 2)", () => {
  it("is checked AND disabled for an education expense, with the locked-goal helper text", async () => {
    mockFlowFetch([baseExpenseRow({ id: "exp-1", type: "education", name: "College" })]);

    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "expense", id: "exp-1", presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        onClose={() => {}}
      />,
    );

    const checkbox = await screen.findByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Education expenses are always goals/)).toBeInTheDocument();
  });

  it("is UNCHECKED and editable for a non-education, non-goal expense — the discriminating case", async () => {
    mockFlowFetch([
      baseExpenseRow({ id: "exp-2", type: "other", name: "New roof", isGoal: false }),
    ]);

    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "expense", id: "exp-2", presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        onClose={() => {}}
      />,
    );

    const checkbox = await screen.findByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeDisabled();
    expect(screen.queryByText(/Education expenses are always goals/)).not.toBeInTheDocument();
  });

  it("is checked (but still editable) for a non-education expense that already opted in via isGoal", async () => {
    mockFlowFetch([
      baseExpenseRow({ id: "exp-3", type: "other", name: "Boat", isGoal: true }),
    ]);

    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "expense", id: "exp-3", presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        onClose={() => {}}
      />,
    );

    const checkbox = await screen.findByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
  });

  it("does not render an Owner select for an expense (owner is incomes-only)", async () => {
    mockFlowFetch([baseExpenseRow({ id: "exp-4", type: "living", name: "Rent" })]);

    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "expense", id: "exp-4", presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        onClose={() => {}}
      />,
    );

    // The expense's own goal checkbox confirms the form finished loading
    // before asserting the Owner select is absent.
    await screen.findByRole("checkbox", { name: /Show as a goal/ });
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
  });

  it("renders an Owner select (Client/Spouse/Joint) for an income and no goal checkbox", async () => {
    mockFlowFetch([
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        annualAmount: "90000",
        startYear: 2026,
        endYear: 2045,
        startYearRef: null,
        endYearRef: null,
        growthRate: "0.03",
        growthSource: "inflation",
        owner: "spouse",
      },
    ]);

    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "income", id: "inc-1", presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        onClose={() => {}}
      />,
    );

    const ownerSelect = await screen.findByLabelText("Owner");
    expect((ownerSelect as HTMLSelectElement).value).toBe("spouse");
    expect(screen.queryByText("Show as a goal")).not.toBeInTheDocument();
  });
});
