// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Untyped `vi.fn()` and forwarding arrow factories: the factory is hoisted above
// these consts, so it must not READ them until call time (render), and an
// untyped mock keeps `mock.calls[0][1].body` assertable without a cast. Both are
// the shipped house pattern — see add-category-form.test.tsx.
const portalFetch = vi.fn();
const refresh = vi.fn();

vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetch,
  usePortalMode: () => ({ mode: "client", clientId: "c1" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OrganizerFlowFormPanel } from "@/components/portal/organizer-flow-form-panel";
import { PORTAL_SAVINGS_INPUT_FIELDS } from "@/lib/portal/portal-savings-input";

const MILESTONES = {
  planStart: 2026, planEnd: 2070, clientRetirement: 2040,
  clientEnd: 2070, spouseRetirement: 2042, spouseEnd: 2072,
};

const base = {
  clientFirstName: "Cooper",
  spouseFirstName: "Dana",
  savingsAccountOptions: [{ id: "acct-1", name: "Joint Brokerage" }],
  milestones: MILESTONES,
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  portalFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  // The panel renders through createPortal into #portal-detail.
  document.body.innerHTML = '<aside id="portal-detail"></aside>';
});

describe("OrganizerFlowFormPanel", () => {
  it("POSTs a new income to the portal route", async () => {
    render(
      <OrganizerFlowFormPanel {...base} target={{ kind: "income", id: null, row: null }} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Salary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(portalFetch).toHaveBeenCalled());
    const [url, init] = portalFetch.mock.calls[0];
    expect(url).toBe("/api/portal/incomes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).name).toBe("Salary");
  });

  it("PUTs an existing expense to its item route", async () => {
    render(
      <OrganizerFlowFormPanel
        {...base}
        target={{
          kind: "expense", id: "e1",
          row: { id: "e1", name: "Rent", annualAmount: "24000", startYear: 2026, endYear: 2040, type: "living", growthRate: "0.03" } as never,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(portalFetch).toHaveBeenCalled());
    const [url, init] = portalFetch.mock.calls[0];
    expect(url).toBe("/api/portal/expenses/e1");
    expect(init.method).toBe("PUT");
  });

  it("seeds 'Show as a goal' when the Goals tab opened it", () => {
    render(
      <OrganizerFlowFormPanel
        {...base}
        target={{ kind: "expense", id: null, row: null, presetIsGoal: true }}
      />,
    );
    expect(screen.getByLabelText("Show as a goal")).toBeChecked();
    // The heading must follow the intent the user arrived with.
    expect(screen.getByRole("heading", { name: "Add goal" })).toBeInTheDocument();
  });

  it("renders an account picker for savings, and no owner picker", () => {
    render(<OrganizerFlowFormPanel {...base} target={{ kind: "savings", id: null, row: null }} />);
    expect(screen.getByLabelText("Account")).toBeInTheDocument();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
  });

  it("never offers growth source or a milestone anchor picker", () => {
    // Advisor levers. Their absence is the design, so it is asserted.
    render(<OrganizerFlowFormPanel {...base} target={{ kind: "income", id: null, row: null }} />);
    expect(screen.queryByText(/inflation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/at retirement/i)).not.toBeInTheDocument();
  });

  it("requires two clicks to delete and calls DELETE on the second", async () => {
    render(
      <OrganizerFlowFormPanel
        {...base}
        target={{
          kind: "income", id: "i1",
          row: { id: "i1", name: "Salary", annualAmount: "100000", startYear: 2026, endYear: 2040, owner: "client", type: "salary", growthRate: "0.03" } as never,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(portalFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(portalFetch).toHaveBeenCalled());
    const [url, init] = portalFetch.mock.calls[0];
    expect(url).toBe("/api/portal/incomes/i1");
    expect(init.method).toBe("DELETE");
  });

  it("surfaces the route's error message and does not close", async () => {
    portalFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "This row is managed by your advisor" }), { status: 403 }),
    );
    const onSaved = vi.fn();
    render(
      <OrganizerFlowFormPanel {...base} onSaved={onSaved} target={{ kind: "income", id: null, row: null }} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This row is managed by your advisor")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows no delete affordance in create mode", () => {
    render(<OrganizerFlowFormPanel {...base} target={{ kind: "income", id: null, row: null }} />);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  // --- Route-contract tests. Not in the plan's block; each pins a rule the
  // --- shipped routes enforce, where a body drift is a 400 in production and
  // --- nothing at all in the eight tests above.

  it("sends the seeded type on an income create — the schema requires it", () => {
    // `incomeCreateSchema.type` is `z.string().min(1)` with NO default
    // (schemas/incomes.ts:147), so an omitted type 400s every portal income
    // create. The plan's field list renders no type picker for income; the
    // seeded value is what the body has to carry.
    render(<OrganizerFlowFormPanel {...base} target={{ kind: "income", id: null, row: null }} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Salary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    return waitFor(() => {
      expect(JSON.parse(portalFetch.mock.calls[0][1].body).type).toBe("salary");
    });
  });

  it("sends EXACTLY the four allowlisted keys on a savings write", async () => {
    // `assertPortalSavingsInput` 400s on any key outside its allowlist, so a
    // stray `name` or `owner` here breaks every savings save, create and edit
    // alike. Compared against the route's OWN constant rather than a copy of it:
    // if that list ever moves, this test moves with it instead of going quietly
    // out of date.
    render(<OrganizerFlowFormPanel {...base} target={{ kind: "savings", id: null, row: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(portalFetch).toHaveBeenCalled());
    expect(Object.keys(JSON.parse(portalFetch.mock.calls[0][1].body)).sort()).toEqual(
      [...PORTAL_SAVINGS_INPUT_FIELDS].sort(),
    );
  });

  it("omits type when editing an expense — retyping stays with the advisor", async () => {
    // An education expense carries institutionState, payShortfallOutOfPocket and
    // a dedicatedAccountIds join this panel does not render. Sending the seeded
    // type back on an edit is how a client would silently retype one.
    render(
      <OrganizerFlowFormPanel
        {...base}
        target={{
          kind: "expense", id: "e1",
          row: { id: "e1", name: "Tuition", annualAmount: "30000", startYear: 2030, endYear: 2034, type: "education", growthRate: "0.03" } as never,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(portalFetch).toHaveBeenCalled());
    expect(JSON.parse(portalFetch.mock.calls[0][1].body)).not.toHaveProperty("type");
  });
});
