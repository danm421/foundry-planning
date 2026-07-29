// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import HouseholdMapView from "../household-map-view";
import { categoryDefaultRates as buildCategoryDefaultRates } from "@/lib/investments/category-default-rates";
import type { HouseholdMapProps, MapItem, MapPerson } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";
import type { ExpenseView, IncomeView, SavingsRuleView } from "@/lib/scenario/view-adapters";
import type { Income } from "@/engine/types";
import { TEST_CLIENT_INFO, TEST_PLAN_SETTINGS } from "./fixtures";

// `useScenarioWriter` branches on the URL's `?scenario=`, and the two branches
// send DIFFERENT payloads on purpose (see lib/household-map/flow-write.ts), so
// the write-path tests below have to be able to turn it on. `vi.hoisted` so the
// hoisted `vi.mock` factory can close over a value the tests mutate per case —
// a bare `let` would be in its TDZ when the factory first runs. Mirrors
// net-worth-board.test.tsx.
const nav = vi.hoisted(() => ({ scenario: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === "scenario" ? nav.scenario : null),
    toString: () => (nav.scenario ? `scenario=${nav.scenario}` : ""),
  }),
  usePathname: () => "/clients/client-1/details/map",
}));

// Mock the dialogs/drawer at the module boundary and capture the props each
// was rendered with, so assertions can prove ROUTING (which editor opened,
// for which id) rather than merely "something opened".
// The mock captures `familyMembers`/`entities` as well as `open`. Asserting
// only `open` is what let the dialog ship mounted with neither: AddAccountForm
// then had an empty `defaultOwners`, OwnershipEditor rendered no owner rows,
// and the create POST 400'd at "owners must have at least one entry" with no
// path forward from the dialog.
vi.mock("@/components/add-account-dialog", () => ({
  default: (props: {
    open: boolean;
    familyMembers?: { id: string; role: string }[];
    entities?: { id: string }[];
  }) => (
    <div
      data-testid="mock-add-account-dialog"
      data-open={String(props.open)}
      data-family-member-roles={(props.familyMembers ?? []).map((f) => f.role).join(",")}
      data-entity-count={String((props.entities ?? []).length)}
    />
  ),
}));

// `schedule` is captured too: the dialog's Schedule grid PUTs a FULL replace,
// so opening a rule that has overrides with `schedule` undefined would show an
// empty grid and let one edit collapse a ten-year schedule.
vi.mock("@/components/forms/savings-rule-dialog", () => ({
  default: (props: {
    open: boolean;
    editing?: { id: string; annualAmount: string };
    schedule?: { year: number; amount: number }[];
  }) => (
    <div
      data-testid="mock-savings-rule-dialog"
      data-open={String(props.open)}
      data-editing-id={props.editing?.id ?? ""}
      data-editing-amount={props.editing?.annualAmount ?? ""}
      data-schedule={JSON.stringify(props.schedule ?? null)}
    />
  ),
}));

// The SS editor, captured the same way. `existingRow` is captured as an ID plus
// the two fields the quick-edit drawer cannot round-trip (`claimingAge`,
// `ssBenefitMode`): asserting only that "a dialog opened" would still pass if the
// Map handed the dialog a row hydrated from `IncomeView`, which carries neither —
// and every scenario would then open at "claim at FRA" and save that back.
vi.mock("@/components/social-security-dialog", () => ({
  SocialSecurityDialog: (props: {
    owner: string;
    existingRow: { id: string; claimingAge?: number; ssBenefitMode?: string } | null;
  }) => (
    <div
      data-testid="mock-social-security-dialog"
      data-owner={props.owner}
      data-existing-id={props.existingRow?.id ?? ""}
      data-claiming-age={String(props.existingRow?.claimingAge ?? "")}
      data-benefit-mode={props.existingRow?.ssBenefitMode ?? ""}
    />
  ),
}));

vi.mock("../quick-edit-drawer", () => ({
  default: (props: {
    target: {
      kind: string;
      id: string | null;
      presetColumn: string;
      presetIsGoal?: boolean;
      row: { annualAmount: string } | null;
    };
  }) => (
    <div
      data-testid="mock-quick-edit-drawer"
      data-kind={props.target.kind}
      data-id={props.target.id ?? ""}
      data-preset-column={props.target.presetColumn}
      data-preset-is-goal={String(props.target.presetIsGoal ?? false)}
      data-row-amount={props.target.row?.annualAmount ?? ""}
    />
  ),
}));

function person(overrides: Partial<MapPerson> = {}): MapPerson {
  return {
    familyMemberId: "fm-default",
    firstName: "Alex",
    age: 45,
    retirementYear: 2045,
    birthYear: 1980,
    ...overrides,
  };
}

function item(overrides: Partial<MapItem> & Pick<MapItem, "id" | "kind" | "column">): MapItem {
  return {
    category: "investments",
    name: "Item",
    valueLabel: "$0",
    value: 0,
    splitChip: null,
    trayOwnerLabel: null,
    noteChip: null,
    timing: null,
    editableAmount: null,
    ...overrides,
  };
}

function goal(overrides: Partial<MapGoal> & Pick<MapGoal, "id">): MapGoal {
  return {
    year: 2030,
    kind: "household",
    side: "client",
    title: "Goal title",
    detail: null,
    expenseId: null,
    forFamilyMemberName: null,
    lifeExpectancy: null,
    ...overrides,
  };
}

function incomeRow(id: string, overrides: Partial<IncomeView> = {}): IncomeView {
  return {
    id,
    type: "salary",
    name: "Salary",
    annualAmount: "90000",
    startYear: 2026,
    endYear: 2045,
    owner: "client",
    claimingAge: null,
    growthRate: "0.03",
    growthSource: "inflation",
    startYearRef: null,
    endYearRef: null,
    ...overrides,
  };
}

function expenseRow(id: string, overrides: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id,
    type: "other",
    name: "Expense",
    annualAmount: "24000",
    startYear: 2026,
    endYear: 2056,
    growthRate: "0.03",
    growthSource: "custom",
    startYearRef: null,
    endYearRef: null,
    isGoal: false,
    isDefault: false,
    ...overrides,
  };
}

/** A Social Security row as `ssIncomeRows` carries it: the FULL engine `Income`,
 *  not an `IncomeView`. The five SS-only fields are what the type exists for. */
function ssIncomeRow(id: string, overrides: Partial<Income> = {}): Income {
  return {
    id,
    type: "social_security",
    name: "Alex Social Security",
    // 0 on purpose — in `pia_at_fra` mode the engine derives the benefit from
    // `piaMonthly` and never reads this column.
    annualAmount: 0,
    startYear: 2024,
    endYear: 2099,
    growthRate: 0.02,
    owner: "client",
    ssBenefitMode: "pia_at_fra",
    piaMonthly: 3200,
    claimingAgeMode: "years",
    claimingAge: 70,
    claimingAgeMonths: 0,
    ...overrides,
  };
}

function savingsRow(id: string, overrides: Partial<SavingsRuleView> = {}): SavingsRuleView {
  return {
    id,
    accountId: "acct-1",
    annualAmount: "5000",
    startYear: 2026,
    endYear: 2045,
    employerMatchPct: null,
    employerMatchCap: null,
    employerMatchAmount: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<HouseholdMapProps> = {}): HouseholdMapProps {
  return {
    clientId: "client-1",
    people: {
      client: person({ familyMemberId: "fm-client", firstName: "Alex" }),
      spouse: person({ familyMemberId: "fm-spouse", firstName: "Jordan" }),
      children: [],
    },
    netWorthLabel: "$500,000",
    items: [],
    goals: [],
    canEdit: true,
    incomeRows: {},
    ssIncomeRows: {},
    expenseRows: {},
    savingsRuleRows: {},
    savingsSchedules: {},
    flowScenarioFields: {},
    clientScenarioFields: {},
    planSettingsScenarioFields: {},
    clientInfo: TEST_CLIENT_INFO,
    planSettings: TEST_PLAN_SETTINGS,
    accountOptions: [],
    // Required on `HouseholdMapProps` as of Task 5. This board does not read
    // either one — they are here so the fixture typechecks against the shared
    // props type, which is the point of having a shared props type.
    accountRows: {},
    growthContext: {
      modelPortfolios: [],
      fundPortfolios: [],
      resolvedInflationRate: 0.025,
      categoryDefaults: {},
    },
    // The real fallback map (all ten categories) rather than a hand-rolled
    // literal — `CategoryDefaultRateMap` requires every key, and calling the
    // shipped function keeps the fixture honest if those defaults ever move.
    categoryDefaultRates: buildCategoryDefaultRates(undefined, [], 0),
    assetClassOptions: [],
    portfolioAllocationsMap: {},
    categoryDefaultSources: {},
    businessOptions: [],
    rothIraAccountOptions: [],
    resolvedInflationRate: 0.03,
    // Ownership context for AddAccountDialog. Non-empty by default because an
    // EMPTY familyMemberOptions is the exact shape that made the dialog's save
    // 400 — see the "+ Add" test below.
    familyMemberOptions: [
      { id: "fm-client", role: "client", firstName: "Alex", birthYear: 1980 },
      { id: "fm-spouse", role: "spouse", firstName: "Jordan", birthYear: 1982 },
    ],
    entityOptions: [{ id: "ent-1", name: "Sample Family Trust" }],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  nav.scenario = null;
});

/** Shared by both inline-write suites; the `afterEach` above restores it. */
function mockFetchOk() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 200 }) as Response);
}

describe("HouseholdMapView — Task 11 card-click and add-button routing", () => {
  it("clicking an income card opens the drawer with kind 'income' and the item's id — DISCRIMINATING case, see report for break/restore evidence", () => {
    const items = [
      item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 }),
    ];
    render(
      <HouseholdMapView {...baseProps({ items, incomeRows: { "inc-1": incomeRow("inc-1") } })} />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Salary" }));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("income");
    expect(drawer.dataset.id).toBe("inc-1");
  });

  it("clicking an expense card opens the drawer with kind 'expense', not 'income'", () => {
    const items = [
      item({ id: "exp-1", kind: "expense", column: "joint", name: "Mortgage payment", value: -24000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({ items, expenseRows: { "exp-1": expenseRow("exp-1") } })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Mortgage payment" }));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("expense");
    expect(drawer.dataset.id).toBe("exp-1");
  });

  it("hands the drawer the SCENARIO-EFFECTIVE row from props, not a base-case fetch", () => {
    const items = [
      item({ id: "exp-1", kind: "expense", column: "joint", name: "Mortgage payment", value: -31000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({
          items,
          // The effective row carries the scenario's override, not the base value.
          expenseRows: { "exp-1": expenseRow("exp-1", { annualAmount: "31000" }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Mortgage payment" }));

    expect(screen.getByTestId("mock-quick-edit-drawer").dataset.rowAmount).toBe("31000");
  });

  it("clicking a savings card opens SavingsRuleDialog editing that specific rule, hydrated from props", () => {
    const items = [
      item({ id: "sav-1", kind: "savings", column: "client", name: "401k contribution", value: -5000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({
          items,
          savingsRuleRows: { "sav-1": savingsRow("sav-1", { annualAmount: "7500" }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit 401k contribution" }));

    const dialog = screen.getByTestId("mock-savings-rule-dialog");
    expect(dialog.dataset.editingId).toBe("sav-1");
    expect(dialog.dataset.editingAmount).toBe("7500");
  });

  // `effectiveTree` synthesizes `source: "policy"` rows (premium-<uuid> expenses,
  // policy-income-<uuid> incomes) that have no DB row, so no write route accepts
  // their ids. `map-content.tsx` gives them no hydration entry — but the card
  // must stay, because a premium is a real outflow and dropping it would
  // understate the band. Non-interactive, not absent.
  it("a synthesized policy row (no hydration entry) renders inert — not a button — yet still counts in the band subtotal", () => {
    const items = [
      item({
        id: "exp-1",
        kind: "expense",
        column: "joint",
        name: "Mortgage payment",
        value: -24000,
      }),
      item({
        id: "premium-3f1c2b7e-0000-4000-8000-000000000000",
        kind: "expense",
        column: "joint",
        category: "insurance",
        name: "Term policy premium",
        value: -1200,
      }),
    ];
    render(
      <HouseholdMapView
        // Only the real expense gets a hydration row — exactly what
        // map-content.tsx's `source !== "policy"` filter produces.
        {...baseProps({ items, expenseRows: { "exp-1": expenseRow("exp-1") } })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));

    const band = screen.getByTestId("band-expense");
    // Still rendered, and still in the subtotal: 24,000 + 1,200.
    expect(within(band).getByText("Term policy premium")).toBeInTheDocument();
    expect(band.querySelector("b")?.textContent).toBe("($25,200)");

    // The writable sibling IS a button; the synthesized row is NOT.
    expect(screen.getByRole("button", { name: /Mortgage payment/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Term policy premium/ })).not.toBeInTheDocument();

    // And clicking it opens nothing.
    fireEvent.click(screen.getByText("Term policy premium"));
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  it("hands SavingsRuleDialog the rule's existing schedule — an empty grid would let one edit replace the whole thing", () => {
    const items = [
      item({ id: "sav-1", kind: "savings", column: "client", name: "401k contribution", value: 0 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({
          items,
          savingsRuleRows: { "sav-1": savingsRow("sav-1") },
          savingsSchedules: {
            "sav-1": [
              { year: 2026, amount: 20000 },
              { year: 2027, amount: 21000 },
            ],
          },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit 401k contribution" }));

    expect(screen.getByTestId("mock-savings-rule-dialog").dataset.schedule).toBe(
      JSON.stringify([
        { year: 2026, amount: 20000 },
        { year: 2027, amount: 21000 },
      ]),
    );
  });

  it("a savings card with no hydration row opens no dialog and is not a button", () => {
    const items = [
      item({ id: "sav-orphan", kind: "savings", column: "client", name: "Orphan contribution" }),
    ];
    render(<HouseholdMapView {...baseProps({ items })} />);

    fireEvent.click(screen.getByText("Cash Flow"));

    expect(screen.queryByRole("button", { name: /Orphan contribution/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Orphan contribution"));
    expect(screen.queryByTestId("mock-savings-rule-dialog")).not.toBeInTheDocument();
  });

  it("a goal card with an expenseId opens the drawer for that expense, kind 'expense'", () => {
    const g = goal({ id: "g1", side: "client", expenseId: "exp-42", title: "College fund" });
    render(
      <HouseholdMapView
        {...baseProps({ goals: [g], expenseRows: { "exp-42": expenseRow("exp-42") } })}
      />,
    );

    fireEvent.click(screen.getByText("Goals"));
    fireEvent.click(screen.getByText("College fund"));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("expense");
    expect(drawer.dataset.id).toBe("exp-42");
  });

  it("a life-milestone goal card (expenseId null) is not clickable and opens nothing", () => {
    const g = goal({ id: "g2", side: "client", expenseId: null, title: "Alex retires" });
    render(<HouseholdMapView {...baseProps({ goals: [g] })} />);

    fireEvent.click(screen.getByText("Goals"));

    expect(screen.queryByRole("button", { name: /Alex retires/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Alex retires"));
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  it("cards are not clickable when canEdit is false", () => {
    const items = [
      item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({ items, canEdit: false, incomeRows: { "inc-1": incomeRow("inc-1") } })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));

    expect(screen.queryByRole("button", { name: /Salary/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Salary"));
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  it("Net Worth board's 'Add account' opens AddAccountDialog WITH the ownership context its save needs (no column/category preset — AddAccountDialog has no prop for one)", () => {
    render(<HouseholdMapView {...baseProps()} />);
    // Default board is Net Worth.
    const addButtons = screen.getAllByRole("button", { name: "Add account" });
    fireEvent.click(addButtons[0]);

    const dialog = screen.getByTestId("mock-add-account-dialog");
    expect(dialog.dataset.open).toBe("true");
    // A "client" family member is the one prop the create path cannot save
    // without: AddAccountForm seeds `defaultOwners` from it, and an empty
    // owners[] is a hard 400 from `ownership.ts`.
    expect(dialog.dataset.familyMemberRoles).toContain("client");
    expect(dialog.dataset.entityCount).toBe("1");
  });

  // A goal is not its own entity — it is an expense carrying `isGoal`. So the
  // ONE thing that makes "Add goal" different from "add an expense" is the
  // preset flag: without it the saved row is an ordinary expense and never
  // appears on the board it was added from.
  it("Goals board's 'Add goal' opens the drawer on a NEW expense with the goal flag preset", () => {
    render(<HouseholdMapView {...baseProps()} />);
    fireEvent.click(screen.getByText("Goals"));

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.presetIsGoal).toBe("true");
  });

  it("Goals board's 'Add goal' opens in CREATE mode on the expense collection", () => {
    render(<HouseholdMapView {...baseProps()} />);
    fireEvent.click(screen.getByText("Goals"));

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("expense");
  });

  it("Goals board's 'Add goal' carries no row id — it is a create, not an edit", () => {
    render(<HouseholdMapView {...baseProps()} />);
    fireEvent.click(screen.getByText("Goals"));

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));

    expect(screen.getByTestId("mock-quick-edit-drawer").dataset.id).toBe("");
  });

  // The band buttons are the Cash Flow board's always-present add path. This
  // pins that they route to the same create-mode drawer as the per-column
  // placeholders, and that they do NOT carry the goal flag — an expense added
  // from the Expenses band is not a goal.
  it("a Cash Flow band's add button opens the drawer WITHOUT the goal flag", () => {
    render(<HouseholdMapView {...baseProps()} />);
    fireEvent.click(screen.getByText("Cash Flow"));

    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.presetIsGoal).toBe("false");
  });

  it("account and liability cards navigate to the Net Worth detail page instead of opening an in-place dialog", () => {
    const items = [
      item({ id: "a1", kind: "account", column: "client", name: "Brokerage account", value: 100000 }),
      item({
        id: "l1",
        kind: "liability",
        column: "client",
        category: "debt",
        name: "Mortgage debt",
        value: -50000,
      }),
    ];
    render(<HouseholdMapView {...baseProps({ items })} />);
    // Default board is Net Worth.
    const clientColumn = screen.getByTestId("column-client");
    const links = within(clientColumn).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/clients/client-1/details/net-worth");
    }
    // Still no in-place account dialog — the full editor lives on that page.
    expect(screen.queryByTestId("mock-add-account-dialog")?.getAttribute("data-open")).not.toBe(
      "true",
    );
  });
});

// An income is editable through EITHER `incomeRows` or `ssIncomeRows`, and WHICH
// map holds it decides which editor opens. The two are disjoint by construction
// (`isHydratableIncome` sends social_security to one and everything else to the
// other), so these tests are about the routing rule, not about the split.
//
// The stakes are asymmetric. Routing a non-SS row to the SS dialog is a visible
// nuisance; routing an SS row to the quick-edit drawer is silent data loss — the
// drawer submits a fixed nine-key body and the scenario writer replaces the
// change payload wholesale, so Save with no edits at all empties the diff and
// deletes a "claim at 70" override, moving the projection, Monte Carlo and
// solver with it.
describe("HouseholdMapView — Social Security card routing", () => {
  function ssItem() {
    return item({
      id: "inc-ss",
      kind: "income",
      column: "client",
      name: "Alex Social Security",
      value: 0,
      // No inline editor on an SS card (see map-items.test.ts) — the pencil is
      // the whole affordance, which is why these tests assert on the button.
      editableAmount: null,
    });
  }

  it("gives an SS card a pencil — a hydration entry in ssIncomeRows makes it editable", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          items: [ssItem()],
          ssIncomeRows: { "inc-ss": ssIncomeRow("inc-ss") },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    expect(screen.getByRole("button", { name: "Edit Alex Social Security" })).toBeInTheDocument();
  });

  // The control. Same card, no hydration entry in EITHER map — it must render
  // inert, or the case above is passing on "every card is a button" rather than
  // on `ssIncomeRows`.
  it("leaves the same card inert when it is in neither hydration map", () => {
    render(<HouseholdMapView {...baseProps({ items: [ssItem()] })} />);

    fireEvent.click(screen.getByText("Cash Flow"));
    expect(
      screen.queryByRole("button", { name: "Edit Alex Social Security" }),
    ).not.toBeInTheDocument();
  });

  it("opens SocialSecurityDialog — NOT the quick-edit drawer — hydrated from the engine row", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          items: [ssItem()],
          ssIncomeRows: { "inc-ss": ssIncomeRow("inc-ss", { claimingAge: 70 }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Alex Social Security" }));

    const dialog = screen.getByTestId("mock-social-security-dialog");
    expect(dialog.dataset.existingId).toBe("inc-ss");
    // The two fields an `IncomeView`-hydrated dialog could not have carried.
    expect(dialog.dataset.claimingAge).toBe("70");
    expect(dialog.dataset.benefitMode).toBe("pia_at_fra");
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  // `owner` is what the dialog reads DOB, retirement age and life expectancy off
  // — the spouse case is the discriminating one, because a hardcoded "client"
  // would satisfy a client-owned row and then quietly resolve a spouse's claim
  // age against the client's birthday.
  it("hands the dialog the row's own owner, so a spouse benefit is not resolved off the client", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          items: [
            item({
              id: "inc-ss-spouse",
              kind: "income",
              column: "spouse",
              name: "Jordan Social Security",
              value: 0,
            }),
          ],
          ssIncomeRows: { "inc-ss-spouse": ssIncomeRow("inc-ss-spouse", { owner: "spouse" }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Jordan Social Security" }));

    expect(screen.getByTestId("mock-social-security-dialog").dataset.owner).toBe("spouse");
  });

  it("narrows a joint-owned SS row to 'client' — the dialog takes only the two principals", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          items: [ssItem()],
          ssIncomeRows: { "inc-ss": ssIncomeRow("inc-ss", { owner: "joint" }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Alex Social Security" }));

    expect(screen.getByTestId("mock-social-security-dialog").dataset.owner).toBe("client");
  });

  // THE REGRESSION GUARD. `handleEditItem` checks `ssIncomeRows` FIRST, and this
  // is the only test that can tell that ordering apart from luck: it contrives
  // the collision the disjointness invariant currently prevents, so if a later
  // change ever admits SS into `incomeRows` — "fixing" `isHydratableIncome`, or
  // widening the drawer — the row must STILL reach the SS dialog rather than the
  // drawer whose Save deletes the claim-age override.
  it("routes to the SS dialog even when the same id is contrived into BOTH maps", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          items: [ssItem()],
          incomeRows: { "inc-ss": incomeRow("inc-ss", { type: "social_security" }) },
          ssIncomeRows: { "inc-ss": ssIncomeRow("inc-ss") },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Alex Social Security" }));

    expect(screen.getByTestId("mock-social-security-dialog").dataset.existingId).toBe("inc-ss");
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  // The other half of the routing rule: an ordinary income must not be caught by
  // the SS branch. Without this, "always open the SS dialog" would pass every
  // case above.
  it("still sends an ordinary salary to the quick-edit drawer", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          items: [item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 })],
          incomeRows: { "inc-1": incomeRow("inc-1") },
          ssIncomeRows: { "inc-ss": ssIncomeRow("inc-ss") },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Salary" }));

    expect(screen.getByTestId("mock-quick-edit-drawer").dataset.id).toBe("inc-1");
    expect(screen.queryByTestId("mock-social-security-dialog")).not.toBeInTheDocument();
  });

  it("does not open the SS dialog on a read-only board", () => {
    render(
      <HouseholdMapView
        {...baseProps({
          canEdit: false,
          items: [ssItem()],
          ssIncomeRows: { "inc-ss": ssIncomeRow("inc-ss") },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    expect(
      screen.queryByRole("button", { name: "Edit Alex Social Security" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-social-security-dialog")).not.toBeInTheDocument();
  });
});

// The seam where a clobbering payload would live. `applyEntityEdit` stores the
// scenario diff as a WHOLESALE replace, so what these tests really assert is
// that a one-field inline edit still carries every other override the scenario
// had — see `lib/household-map/flow-write.ts`.
describe("HouseholdMapView — inline Cash Flow amount writes", () => {
  /** An income card that is inline-editable end to end: a hydration row (which
   *  is what makes it writable), a `editableAmount`, and a scenario field set. */
  function editableIncomeProps(overrides: Partial<HouseholdMapProps> = {}) {
    return baseProps({
      items: [
        item({
          id: "inc-1",
          kind: "income",
          column: "client",
          name: "Alex salary",
          value: 250000,
          valueLabel: "$250,000",
          editableAmount: 250000,
        }),
      ],
      incomeRows: { "inc-1": incomeRow("inc-1") },
      flowScenarioFields: {
        "inc-1": {
          type: "salary",
          name: "Alex salary",
          annualAmount: 250000,
          startYear: 2026,
          endYear: 2035,
          growthRate: 0.03,
          owner: "client",
          // The scenario's own override on the end of the window, plus a field
          // `IncomeView` does not carry at all. Both must survive an amount edit.
          endYearRef: "client_retirement",
          isSelfEmployment: true,
        },
      },
      ...overrides,
    });
  }

  async function editAmount(name: string, next: string) {
    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByRole("button", { name: `Edit amount for ${name}` }));
    const input = screen.getByRole("textbox", { name: `Amount for ${name}` });
    fireEvent.change(input, { target: { value: next } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  it("base mode PUTs only the changed field to the income route", async () => {
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableIncomeProps()} />);

    await editAmount("Alex salary", "275000");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/client-1/incomes/inc-1");
    expect(init.method).toBe("PUT");
    // Narrow ON PURPOSE — the per-entity PUT applies a partial update, so
    // anything extra here would be a field the Map re-asserts without being asked.
    expect(JSON.parse(init.body as string)).toEqual({ annualAmount: "275000" });
  });

  // DISCRIMINATING: a narrow `{annualAmount}` scenario write would make the new
  // payload the ONLY entry, deleting the endYearRef override this scenario
  // already had. That failure is silent — the year just reverts to base.
  it("scenario mode POSTs the WHOLE field set, preserving the scenario's other overrides", async () => {
    nav.scenario = "sc-1";
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableIncomeProps()} />);

    await editAmount("Alex salary", "275000");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/client-1/scenarios/sc-1/changes");
    const body = JSON.parse(init.body as string);
    expect(body.op).toBe("edit");
    expect(body.targetKind).toBe("income");
    expect(body.targetId).toBe("inc-1");
    expect(body.desiredFields.annualAmount).toBe("275000");
    expect(body.desiredFields.endYearRef).toBe("client_retirement");
    expect(body.desiredFields.isSelfEmployment).toBe(true);
    expect(body.desiredFields.owner).toBe("client");
  });

  // `savings` is not a TargetKind — the changes route's zod enum would 400 — and
  // `/api/clients/[id]/savings/[id]` does not exist. Both halves have to be
  // right, and neither is derivable from `item.kind` by string.
  it("a savings row routes to the savings_rule kind and the savings-rules route", async () => {
    const fetchSpy = mockFetchOk();
    render(
      <HouseholdMapView
        {...baseProps({
          items: [
            item({
              id: "sav-1",
              kind: "savings",
              column: "client",
              name: "401k contribution",
              value: -12000,
              valueLabel: "($12,000)",
              editableAmount: 12000,
            }),
          ],
          savingsRuleRows: { "sav-1": savingsRow("sav-1", { annualAmount: "12000" }) },
          flowScenarioFields: {
            "sav-1": { accountId: "acct-1", annualAmount: 12000, isDeductible: true },
          },
        })}
      />,
    );

    await editAmount("401k contribution", "15000");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/client-1/savings-rules/sav-1");
  });

  it("scenario mode sends targetKind 'savings_rule' for a savings row", async () => {
    nav.scenario = "sc-1";
    const fetchSpy = mockFetchOk();
    render(
      <HouseholdMapView
        {...baseProps({
          items: [
            item({
              id: "sav-1",
              kind: "savings",
              column: "client",
              name: "401k contribution",
              value: -12000,
              valueLabel: "($12,000)",
              editableAmount: 12000,
            }),
          ],
          savingsRuleRows: { "sav-1": savingsRow("sav-1", { annualAmount: "12000" }) },
          flowScenarioFields: {
            "sav-1": { accountId: "acct-1", annualAmount: 12000, isDeductible: true },
          },
        })}
      />,
    );

    await editAmount("401k contribution", "15000");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).targetKind).toBe("savings_rule");
  });

  // Unreachable in production — `map-content.tsx` builds `flowScenarioFields`
  // and the hydration maps from the same tree with the same filters, and the
  // board gates the editor on the hydration entry. This pins the behaviour if
  // they ever drift: the writer must REFUSE, because with no field set the only
  // payload it could build is the narrow scenario write that deletes the row's
  // other overrides. Sending nothing beats sending that.
  it("refuses to write a row whose scenario field set is missing rather than falling back to a narrow payload", async () => {
    nav.scenario = "sc-1";
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableIncomeProps({ flowScenarioFields: {} })} />);

    await editAmount("Alex salary", "275000");

    // Waits for the editor to close (the commit is async even when it refuses),
    // and pins that the card came back showing the UNCHANGED figure rather than
    // a phantom save.
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit amount for Alex salary" })).toHaveTextContent(
        "$250,000",
      ),
    );
    // Nothing was sent — not a narrow `{annualAmount}` POST, not anything.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Life expectancy is the only field on this page that moves the PLAN HORIZON,
// and the horizon lives on two singletons — `client.planEndAge` and
// `planSettings.planEndYear` — while the engine's year loop is bounded by the
// latter. So the two modes send genuinely different things, and "one write per
// mode" is wrong in one direction and "two writes per mode" is wrong in the
// other. That asymmetry is what these tests exist to pin.
describe("HouseholdMapView — inline life-expectancy writes", () => {
  // Alex born 1980, Jordan born 1982. Both die 2072 at the stored ages, so the
  // fixture is a TIE at rest and every case below moves exactly one of them.
  const CLIENT_SCENARIO_FIELDS = {
    firstName: "Alex",
    dateOfBirth: "1980-05-10",
    lifeExpectancy: 92,
    spouseName: "Jordan",
    spouseDob: "1982-09-01",
    spouseLifeExpectancy: 90,
    planEndAge: 92,
    filingStatus: "married_joint",
    // The Solver's signature override — "retire at 62". The whole-singleton
    // payload exists to stop a life-expectancy edit deleting it.
    retirementAge: 62,
  };

  const PLAN_SETTINGS_SCENARIO_FIELDS = {
    flatFederalRate: 0.22,
    inflationRate: 0.028,
    planStartYear: 2026,
    planEndYear: 2072,
  };

  function lifeExpectancyGoal(owner: "client" | "spouse"): MapGoal {
    const age = owner === "client" ? 92 : 90;
    const birthYear = owner === "client" ? 1980 : 1982;
    const firstName = owner === "client" ? "Alex" : "Jordan";
    return goal({
      id: `milestone:${owner}_life_expectancy`,
      kind: "life_expectancy",
      side: owner,
      title: `${firstName}'s life expectancy`,
      detail: `age ${age}`,
      year: birthYear + age,
      lifeExpectancy: { owner, age, assumed: false },
    });
  }

  function editableLifeExpectancyProps(overrides: Partial<HouseholdMapProps> = {}) {
    return baseProps({
      people: {
        client: person({ familyMemberId: "fm-client", firstName: "Alex", birthYear: 1980 }),
        spouse: person({ familyMemberId: "fm-spouse", firstName: "Jordan", birthYear: 1982 }),
        children: [],
      },
      goals: [lifeExpectancyGoal("client"), lifeExpectancyGoal("spouse")],
      clientScenarioFields: CLIENT_SCENARIO_FIELDS,
      planSettingsScenarioFields: PLAN_SETTINGS_SCENARIO_FIELDS,
      ...overrides,
    });
  }

  async function editAge(name: string, next: string) {
    fireEvent.click(screen.getByText("Goals"));
    fireEvent.click(screen.getByRole("button", { name: `Edit life expectancy for ${name}` }));
    const input = screen.getByRole("textbox", { name: `Life expectancy for ${name}` });
    fireEvent.change(input, { target: { value: next } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  // ONE write, and nothing else. The PUT route re-derives `planEndAge` itself
  // and pushes the new `planEndYear` to every one of the client's plan_settings
  // rows, so a second write here would be the Map re-asserting a horizon it does
  // not own — and sending our own `planEndAge` would land in
  // `MUTABLE_CLIENT_FIELDS` only to be overwritten by the route's.
  it("base mode PUTs only the changed column, and posts no scenario change", async () => {
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableLifeExpectancyProps()} />);

    await editAge("Alex", "96");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/client-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ lifeExpectancy: 96 });

    // Explicit, because "one call" and "no horizon POST" fail differently.
    expect(
      fetchSpy.mock.calls.some(([u]) => String(u).includes("/changes")),
    ).toBe(false);
  });

  it("base mode routes a spouse edit to the spouse column", async () => {
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableLifeExpectancyProps()} />);

    await editAge("Jordan", "88");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ spouseLifeExpectancy: 88 });
  });

  // TWO rows, because `planEndAge` lives on the `client` singleton and
  // `planEndYear` on `plan_settings`, and one scenario_change row targets
  // exactly one kind. A spouse edit on purpose: it moves the horizon to a
  // number that is neither the age typed (100) nor the age replaced (90), so a
  // handler that echoed the input, or that only recomputed for client-side
  // edits, cannot pass.
  it("scenario mode posts the client change THEN the plan_settings change", async () => {
    nav.scenario = "sc-1";
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableLifeExpectancyProps()} />);

    // Jordan 1982 + 100 -> 2082, past Alex's 2072. Alex is born 1980, so 2082
    // is his age 102.
    await editAge("Jordan", "100");

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const [clientUrl, clientInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(clientUrl).toBe("/api/clients/client-1/scenarios/sc-1/changes");
    const clientBody = JSON.parse(clientInit.body as string);
    expect(clientBody.op).toBe("edit");
    expect(clientBody.targetKind).toBe("client");
    expect(clientBody.targetId).toBe("client-1");
    expect(clientBody.desiredFields.spouseLifeExpectancy).toBe(100);
    expect(clientBody.desiredFields.planEndAge).toBe(102);
    // The clobber guard: the scenario's Solver override survives the edit.
    expect(clientBody.desiredFields.retirementAge).toBe(62);
    expect(clientBody.desiredFields.lifeExpectancy).toBe(92);

    const [horizonUrl, horizonInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(horizonUrl).toBe("/api/clients/client-1/scenarios/sc-1/changes");
    const horizonBody = JSON.parse(horizonInit.body as string);
    expect(horizonBody.op).toBe("edit");
    expect(horizonBody.targetKind).toBe("plan_settings");
    // The CLIENT ID, not the Solver's `"plan_settings"` sentinel — target_id is
    // a `uuid` column, and that sentinel is why there are zero plan_settings
    // rows in production. (This fixture's id is not itself a uuid; the uuid rule
    // is pinned in `life-expectancy-write-contract.test.ts`.)
    expect(horizonBody.targetId).toBe("client-1");
    expect(horizonBody.desiredFields.planEndYear).toBe(2082);
    expect(horizonBody.desiredFields.inflationRate).toBe(0.028);
  });

  // Not atomic — the route offers no way to write both kinds in one request. If
  // the first fails there is nothing to keep consistent, so the second must not
  // be sent: posting a horizon for a life expectancy that was never stored is
  // strictly worse than posting neither.
  it("scenario mode does not post the horizon when the client change fails", async () => {
    nav.scenario = "sc-1";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 500 }) as Response);
    render(<HouseholdMapView {...editableLifeExpectancyProps()} />);

    await editAge("Jordan", "100");

    // Waiting for the TRIGGER to come back, not for a timer: the editor only
    // closes once `onSave` has resolved, and a second POST would have been
    // issued before that resolution. So the reappearing button is proof the
    // handler ran to completion — a `setTimeout(0)` only proves a tick passed.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit life expectancy for Jordan" }),
      ).toHaveTextContent("90"),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string).targetKind).toBe(
      "client",
    );
  });

  // Below the person's current age the derived death year lands before the plan
  // starts, `computeFinalDeathYear` returns null, and the projection then runs
  // with NO death event at all. Rejected before anything is written — the gate
  // has to be on this side of the fetch.
  it("refuses an age below the person's current age without writing anything", async () => {
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableLifeExpectancyProps()} />);

    await editAge("Alex", "5");

    // Waits for the editor to close (the commit is async even when it refuses)
    // and pins that the card came back showing the UNCHANGED age.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit life expectancy for Alex" }),
      ).toHaveTextContent("92"),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an age past the 110 ceiling without writing anything", async () => {
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableLifeExpectancyProps()} />);

    await editAge("Alex", "115");

    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit life expectancy for Alex" }),
      ).toHaveTextContent("92"),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("writes nothing when the viewer may not edit — the age is not even a field", async () => {
    const fetchSpy = mockFetchOk();
    render(<HouseholdMapView {...editableLifeExpectancyProps({ canEdit: false })} />);

    fireEvent.click(screen.getByText("Goals"));

    expect(screen.queryByRole("button", { name: /Edit life expectancy/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 92")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
