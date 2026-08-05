// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TEST_SOLO_PEOPLE,
  TEST_INCOME_ITEM,
} from "@/components/household-map/__tests__/fixtures";
import type { MapItem } from "@/lib/household-map/types";

// `vi.mock`'s factory is hoisted above every import, including the `const`
// below it — a plain `const loadOrganizerMap = vi.fn()` would be read by the
// factory before its own initializer runs (`ReferenceError: Cannot access
// 'loadOrganizerMap' before initialization`). `vi.hoisted()` hoists the
// declaration together with the mock call so the factory sees an initialized
// value. Mirrors `organizer-redirects.test.ts`'s mock of `permanentRedirect`.
const { loadOrganizerMap } = vi.hoisted(() => ({ loadOrganizerMap: vi.fn() }));
vi.mock("@/lib/portal/load-organizer-map", () => ({ loadOrganizerMap }));
// The screen now returns a client component, so its hooks run for real.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import OrganizerCashFlowScreen from "../organizer-cash-flow-screen";

/** Absent from `incomeRows` — SS keeps its card and its place in the subtotal,
 *  but `isPortalWritableIncome` refuses it, so it must carry no pencil. */
const SS_ITEM: MapItem = {
  ...TEST_INCOME_ITEM,
  id: "i-ss",
  name: "Social Security",
  valueLabel: "$40,000",
  value: 40000,
};

/** Synthesized from a policy: exists only in the effective tree, and its id is
 *  not a uuid any write route accepts. Absent from `expenseRows`. */
const POLICY_ITEM: MapItem = {
  ...TEST_INCOME_ITEM,
  id: "policy:p1",
  kind: "expense",
  name: "Policy premium",
  valueLabel: "($6,000)",
  value: -6000,
};

/** Entity-owned, so `buildMapBoards` puts it in the tray. Writable by the
 *  predicates, but a tray row is never editable from the portal. */
const TRAY_ITEM: MapItem = {
  ...TEST_INCOME_ITEM,
  id: "i-tray",
  name: "S-Corp revenue",
  column: "tray",
  trayOwnerLabel: "Cooper LLC",
};

const MILESTONES = {
  planStart: 2026,
  planEnd: 2070,
  clientRetirement: 2040,
  clientEnd: 2070,
};

const DATA = {
  people: TEST_SOLO_PEOPLE,
  goals: [],
  canEdit: true,
  items: [TEST_INCOME_ITEM, SS_ITEM, POLICY_ITEM, TRAY_ITEM],
  // Membership IS the writability probe. Salary and the tray row are hydrated;
  // Social Security and the policy premium deliberately are not.
  incomeRows: {
    i1: { id: "i1", name: "Salary", annualAmount: "200000", startYear: 2026, endYear: 2040, owner: "client", type: "salary", growthRate: "0.03" },
    "i-tray": { id: "i-tray", name: "S-Corp revenue", annualAmount: "50000", startYear: 2026, endYear: 2040, owner: "client", type: "other", growthRate: "0.03" },
  },
  expenseRows: {},
  savingsRuleRows: {},
  savingsAccountOptions: [{ id: "acct-1", name: "Joint Brokerage" }],
  familyMemberOptions: [],
  milestones: MILESTONES,
  resolvedInflationRate: 0.03,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadOrganizerMap.mockResolvedValue(DATA);
  document.body.innerHTML = "";
});

describe("OrganizerCashFlowScreen", () => {
  it("renders a notice when the household has no board data", async () => {
    loadOrganizerMap.mockResolvedValue(null);
    const { container } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(container.textContent).toContain("advisor");
    expect(container.querySelector("[data-testid^='band-']")).toBeNull();
  });

  it("places a card in its owner column", async () => {
    const { getByTestId } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(getByTestId("band-income-column-client").textContent).toContain("Salary");
  });

  // The three add buttons are the BOARD's own per-band buttons, not a header
  // bar. See organizer-cash-flow-client.tsx for why a header bar would have
  // duplicated them: CashFlowBoard gates them on `canEdit` alone, so — unlike
  // GoalsBoard — withholding the callback cannot suppress them, and suppressing
  // them at the board would change the advisor Map.
  it("renders the three band add buttons when editing is enabled", async () => {
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(screen.getByRole("button", { name: "Add income" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add savings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeInTheDocument();
  });

  it("renders no add or edit affordance when the advisor has editing off", async () => {
    loadOrganizerMap.mockResolvedValue({ ...DATA, canEdit: false });
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(screen.queryByRole("button", { name: "Add income" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("gives an ordinary income a pencil, and a social-security row none", async () => {
    // SS keeps its CARD — it is real income and belongs in the subtotal — but
    // carries no editor, because incomeRows omits it.
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(screen.getByRole("button", { name: "Edit Salary" })).toBeInTheDocument();
    expect(screen.getByText("Social Security")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Social Security" })).not.toBeInTheDocument();
  });

  it("gives a synthesized policy premium no pencil while keeping its card", async () => {
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(screen.getByText("Policy premium")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Policy premium" })).not.toBeInTheDocument();
  });

  it("gives an entity-owned tray row no pencil", async () => {
    // Hydrated in incomeRows, so ONLY the tray check can refuse it — without
    // that check this row would carry a pencil.
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(screen.getByText("S-Corp revenue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit S-Corp revenue" })).not.toBeInTheDocument();
  });

  it("opens a create panel from a band's add button", async () => {
    // The presence test above cannot catch this: those buttons render on
    // `canEdit` alone, so they exist whether or not `onAddFlow` is wired. Only
    // clicking one proves the callback reached the board.
    document.body.innerHTML = '<aside id="portal-detail"></aside>';
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add income" }));
    expect(await screen.findByRole("heading", { name: "Add income" })).toBeInTheDocument();
  });

  it("opens the flow panel when a pencil is clicked", async () => {
    document.body.innerHTML = '<aside id="portal-detail"></aside>';
    render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Salary" }));
    expect(await screen.findByRole("heading", { name: "Edit income" })).toBeInTheDocument();
  });
});
