// @vitest-environment jsdom
/**
 * Integration coverage for the Inflows & Outflows inline write path — the half
 * neither `income-expenses/row.test.tsx` (the presentational Row) nor the
 * per-cell suites can reach, because it only exists once `IncomeExpensesView`
 * wires a cell to `saveIncomeField` / `saveExpenseField`.
 *
 * What it pins, and why each one is a hazard rather than a nicety:
 *
 *   1. A SCENARIO payload carries fields the VIEW ROW does not have. The view
 *      rows are `incomeEngineToView` / `expenseEngineToView` output — strict
 *      subsets of the engine types — and `applyEntityEdit` stores the payload as
 *      a wholesale REPLACE. A key missing from `desiredFields` doesn't go
 *      unwritten; the scenario's existing override for it is DELETED. So the
 *      field set has to come from the server-built prop, and a test that reads
 *      the view row instead must go red.
 *   2. A row with NO field-map entry refuses the write outright. Sending the
 *      narrow payload instead would be exactly the deletion in (1).
 *   3. The BASE body is the patch alone. The full-row body this replaced sent
 *      `endsAtMedicareEligibilityOwner: … ?? null` off a view row that never
 *      populates it, so it wrote a literal null over the Medicare auto-end flag.
 *   4. `showSSRefs` tracks the row's REF, not its type. `INCOME_GROUPS` has no
 *      `social_security` group at all, so a type-based predicate is constant
 *      false — and the defect it hides is invisible until the dropdown opens.
 *   5. The optimistic update carries the WHOLE patch, not just an amount.
 *   6. A read-only user gets no pencil and no editable cells.
 *
 * Harness/fixture shape follows `income-expenses-view-readonly.test.tsx`, which
 * already mounts the full view; the writer stub is the one addition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Writer stub — hoisted so the `vi.mock` factory below can close over it.
//
// `submit` NEVER resolves. The optimistic-update case depends on a save being
// still in flight while the row re-renders; a stub that resolved eagerly would
// let the rollback/refresh path run and hide what is being asserted.
// ---------------------------------------------------------------------------
const stub = vi.hoisted(() => {
  const calls: { edit: Record<string, unknown>; base: Record<string, unknown> }[] = [];
  const submit = (edit: unknown, base: unknown) => {
    calls.push({
      edit: edit as Record<string, unknown>,
      base: base as Record<string, unknown>,
    });
    return new Promise<Response>(() => {});
  };
  return { calls, submit };
});

function desiredFields(n: number): Record<string, unknown> {
  return stub.calls[n].edit.desiredFields as Record<string, unknown>;
}

function baseBody(n: number): Record<string, unknown> {
  return stub.calls[n].base.body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: stub.submit, scenarioActive: false }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { ClientMilestones } from "@/lib/milestones";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "test-client-id";

const MILESTONES: ClientMilestones = {
  planStart: 2026,
  planEnd: 2066,
  clientRetirement: 2035,
  clientEnd: 2060,
  clientSS62: 2028,
  clientSSFRA: 2033,
  clientSS70: 2036,
};

const INCOME = {
  id: "inc-1",
  type: "business" as const,
  name: "Cooper Consulting",
  annualAmount: "200000",
  startYear: 2026,
  endYear: 2034,
  owner: "client" as const,
  claimingAge: null,
  growthRate: "0.03",
  growthSource: "custom",
  startYearRef: "plan_start",
  endYearRef: "client_retirement",
};

/**
 * The server-built field set for that income: the pruned EFFECTIVE ENGINE row.
 * `isSelfEmployment` is the point — `incomeEngineToView` drops it, and the
 * Solver writes it (`mutations-to-scenario-changes.ts`), so it exists only here.
 */
const INCOME_FIELDS: Record<string, unknown> = {
  type: "business",
  name: "Cooper Consulting",
  annualAmount: "200000",
  startYear: 2026,
  endYear: 2034,
  owner: "client",
  growthRate: "0.03",
  growthSource: "custom",
  startYearRef: "plan_start",
  endYearRef: "client_retirement",
  isSelfEmployment: true,
};

/** An INSURANCE expense: the group whose rows carry the Medicare auto-end flag. */
const EXPENSE = {
  id: "exp-1",
  type: "insurance" as const,
  name: "Medicare Bridge",
  annualAmount: "12000",
  startYear: 2030,
  endYear: 2034,
  growthRate: "0.02",
  growthSource: "custom",
  startYearRef: null,
  endYearRef: null,
  isDefault: false,
  // Deliberately absent, exactly as `expenseEngineToView` leaves it:
  // endsAtMedicareEligibilityOwner
};

const EXPENSE_FIELDS: Record<string, unknown> = {
  type: "insurance",
  name: "Medicare Bridge",
  annualAmount: "12000",
  startYear: 2030,
  endYear: 2034,
  growthRate: "0.02",
  growthSource: "custom",
  startYearRef: null,
  endYearRef: null,
  endsAtMedicareEligibilityOwner: "client",
};

const BASE_PROPS = {
  clientId: CLIENT_ID,
  initialIncomes: [INCOME],
  initialExpenses: [EXPENSE],
  initialSavingsRules: [],
  accounts: [],
  entities: [],
  ownerNames: { clientName: "Cooper Smith", spouseName: null },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: { [INCOME.id]: INCOME_FIELDS, [EXPENSE.id]: EXPENSE_FIELDS },
  resolvedInflationRate: 0.03,
  clientInfo: {
    clientRetirementYear: 2035,
    clientEndYear: 2060,
    planStartYear: 2026,
    planEndYear: 2066,
    milestones: MILESTONES,
  },
};

type Props = React.ComponentProps<typeof IncomeExpensesView>;

function renderView(overrides: Partial<Props> = {}, permission: "edit" | "view" = "edit") {
  render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} {...overrides} />
    </ClientAccessProvider>,
  );
}

/** Open a year cell's `<select>` and pick a milestone ref. */
async function pickYearRef(user: ReturnType<typeof userEvent.setup>, cell: string, ref: string) {
  await user.click(screen.getByRole("button", { name: `Change ${cell}` }));
  await user.selectOptions(screen.getByRole("combobox"), ref);
}

beforeEach(() => {
  stub.calls.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncomeExpensesView inline writes", () => {
  it("sends a scenario field the VIEW ROW does not carry", async () => {
    const user = userEvent.setup();
    renderView();
    await pickYearRef(user, "start year for Cooper Consulting", "client_retirement");

    expect(stub.calls).toHaveLength(1);
    // Built from the server-side prop, not from `income` — the view row has no
    // such key, and a payload that omits it DELETES the scenario's override.
    expect(desiredFields(0).isSelfEmployment).toBe(true);
  });

  it("merges the year pair over the field set, as numbers", async () => {
    const user = userEvent.setup();
    renderView();
    await pickYearRef(user, "start year for Cooper Consulting", "client_retirement");

    // A STRING year would diff false against the number-typed base tree and
    // write a spurious override.
    expect(desiredFields(0)).toMatchObject({
      startYear: 2035,
      startYearRef: "client_retirement",
    });
  });

  it("refuses the write when the row has no field-map entry", async () => {
    const user = userEvent.setup();
    renderView({ flowScenarioFields: {} });
    await pickYearRef(user, "start year for Cooper Consulting", "client_retirement");

    expect(stub.calls).toHaveLength(0);
  });

  it("sends ONLY the patch as the base body", async () => {
    const user = userEvent.setup();
    renderView();
    await pickYearRef(user, "start year for Medicare Bridge", "client_retirement");

    expect(Object.keys(baseBody(0)).sort()).toEqual(["startYear", "startYearRef"]);
  });

  // Its own `it`: the key-set assertion above would still pass if the body
  // grew a DIFFERENT stray key, and this one names the field that actually got
  // clobbered — a null here clears the Medicare auto-end flag.
  it("never sends endsAtMedicareEligibilityOwner in the base body", async () => {
    const user = userEvent.setup();
    renderView();
    await pickYearRef(user, "start year for Medicare Bridge", "client_retirement");

    expect(baseBody(0)).not.toHaveProperty("endsAtMedicareEligibilityOwner");
  });

  it("offers the row's own SS anchor in the dropdown", async () => {
    const user = userEvent.setup();
    // A NON-SS income anchored to an SS milestone — what the Solver and the
    // importer write. `INCOME_GROUPS` has no social_security group, so a
    // type-based `showSSRefs` is constant false and this option vanishes.
    renderView({
      initialIncomes: [{ ...INCOME, startYearRef: "client_ss_62", startYear: 2028 }],
    });
    await user.click(
      screen.getByRole("button", { name: "Change start year for Cooper Consulting" }),
    );

    expect(screen.getByRole("option", { name: /Client Age 62/ })).toBeInTheDocument();
  });

  it("applies the WHOLE patch optimistically, not just an amount", async () => {
    const user = userEvent.setup();
    renderView();
    await pickYearRef(user, "start year for Cooper Consulting", "client_retirement");

    // The save is still in flight; the row must already show the new anchor.
    expect(
      screen.getByRole("button", { name: "Change start year for Cooper Consulting" }),
    ).toHaveTextContent("Client Retirement (2035)");
  });

  it("gives a read-only user no pencil and no editable cells", () => {
    renderView({}, "view");

    expect(screen.queryByRole("button", { name: "Edit Cooper Consulting" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Change start year for Cooper Consulting" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Change growth rate for Cooper Consulting" }),
    ).toBeNull();
  });

  // Separate from the affordance check above: read-only must still SHOW the
  // data. A cell that rendered nothing would pass the queryBy assertions.
  it("still shows the year and rate to a read-only user", () => {
    renderView({}, "view");

    expect(screen.getByText("Plan Start (2026)")).toBeInTheDocument();
    expect(screen.getByText("3.00%")).toBeInTheDocument();
  });
});
