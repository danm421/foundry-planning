// src/lib/household-map/types.ts
import type { MapGoal } from "./goals";
import type {
  AccountViewEngineFields,
  ExpenseView,
  IncomeView,
  SavingsRuleView,
} from "@/lib/scenario/view-adapters";

/** Which column of a Household Map board an item belongs in. `tray` is the
 *  bottom strip for anything not owned by the client or spouse. */
export type MapColumn = "client" | "joint" | "spouse" | "tray";

/** Lookup data `assignColumn` needs to resolve ids to roles and labels. */
export interface ColumnContext {
  /** family_member id → household role. */
  roleByFamilyMemberId: ReadonlyMap<string, "client" | "spouse" | "child" | "other">;
  /** family_member id → display name, for tray labels. */
  nameByFamilyMemberId: ReadonlyMap<string, string>;
  /** entity id → display name, for tray labels. */
  nameByEntityId: ReadonlyMap<string, string>;
}

export interface ColumnAssignment {
  column: MapColumn;
  /** e.g. "60/40". Null when the split is 50/50 or the item isn't joint. */
  splitChip: string | null;
  /** Owner label shown on a tray card. Null for non-tray columns. */
  trayOwnerLabel: string | null;
}

/** A household member drawn as a node at the top of a board column. */
export interface MapPerson {
  familyMemberId: string | null;
  firstName: string;
  age: number | null;
  retirementYear: number | null;
  /** Calendar year of birth. Sliced from the DOB string (see
   *  `birthYearFromDob` in `@/lib/age-year`) rather than derived from `age` +
   *  the current year, so boards can compute a person's age in an arbitrary
   *  future/past year without redoing that timezone-sensitive math. */
  birthYear: number | null;
}

/** One card on a board. Assembled server-side by the map route's adapters. */
export interface MapItem {
  id: string;
  /** No `"policy"` member: policy-SOURCED rows do exist on the board, but they
   *  arrive as synthesized expenses/incomes and carry `kind: "expense"` /
   *  `"income"`. A `"policy"` member with no producer only invites
   *  `item.kind === "policy"` guards that never fire. */
  kind: "account" | "liability" | "income" | "savings" | "expense";
  category: "investments" | "property" | "debt" | "household" | "insurance";
  name: string;
  /** Pre-formatted for display, e.g. "$160,000" or "($10,000)". */
  valueLabel: string;
  /**
   * Signed, for subtotals: `items.reduce((s, i) => s + i.value, 0)` must be
   * correct for flow kinds with no kind-specific special-casing by the
   * caller. Inflows (accounts, incomes) are positive. Outflows are negative
   * — liabilities, expenses, AND savings, since a contribution is money
   * leaving the household's cash flow just like an expense. A savings rule
   * the projection alone can resolve (percent-of-pay, contribute-max — both
   * need the owner's salary or IRS limit/age, which live in the engine, not
   * this adapter) carries `0` here; the rule itself is shown in `valueLabel`
   * instead of a number the engine would later overrule.
   */
  value: number;
  column: MapColumn;
  splitChip: string | null;
  trayOwnerLabel: string | null;
  /** Extra chip, e.g. "for Kelly" or "8% + 4% match". */
  noteChip: string | null;
}

/** The single prop object every Household Map board reads. */
export interface HouseholdMapProps {
  clientId: string;
  people: { client: MapPerson; spouse: MapPerson | null; children: MapPerson[] };
  netWorthLabel: string;
  items: MapItem[];
  goals: MapGoal[];
  canEdit: boolean;

  // ── Editor hydration rows ────────────────────────────────────────────────
  // The Map renders SCENARIO-EFFECTIVE data (`loadEffectiveTree(..., scenario)`),
  // so its editors must hydrate from the same tree. Fetching the base-case
  // list-GETs instead would seed the forms with base values, and since a
  // scenario-mode save REPLACES the change payload wholesale, every untouched
  // field would overwrite that scenario's override. These rows come from the
  // exact `effectiveTree` the cards are built from, keyed by id, so an edit
  // made inside a scenario round-trips the scenario's own numbers.
  // Consequence: this feature does ZERO client-side data fetching.

  /** income id → scenario-effective row, for the quick-edit drawer. */
  incomeRows: Record<string, IncomeView>;
  /** expense id → scenario-effective row, for the quick-edit drawer. */
  expenseRows: Record<string, ExpenseView>;
  /** savings-rule id → scenario-effective row, for `SavingsRuleDialog`. */
  savingsRuleRows: Record<string, SavingsRuleView>;
  /**
   * savings-rule id → its year-by-year contribution overrides, ascending.
   * A SEPARATE map because `savingsRuleEngineToView` is a documented partial
   * that does not carry `scheduleOverrides`. Without it `SavingsRuleDialog`
   * opens with `hasSchedule=false` and an empty Schedule grid, hides its
   * "Using custom schedule" banner, and the grid's raw-`fetch` PUT is a FULL
   * replace — so adding one year to a 10-year schedule from the Map would
   * collapse ten overrides into one. Mirrors `income-expenses-view.tsx`'s
   * `ScheduleMap`. Rules with no overrides are simply absent.
   */
  savingsSchedules: Record<string, { year: number; amount: number }[]>;
  /** Every account, for `SavingsRuleDialog`'s target picker (it filters
   *  eligibility itself via `isSavingsEligibleAccount`). Engine fields only —
   *  a superset of the `{id, name, category, subType, ownerEntityId}` the
   *  picker reads. */
  accountOptions: AccountViewEngineFields[];

  /**
   * Ownership context for the Net Worth board's "+ Add" → `AddAccountDialog`.
   * NOT optional: with no `familyMembers` the form's `defaultOwners` is empty,
   * `OwnershipEditor` renders no owner rows, `canSave` still passes on the name
   * alone, and the POST 400s at `ownership.ts`'s "owners must have at least one
   * entry". Three of those buttons render on the DEFAULT board, so the dialog
   * has to arrive already able to save.
   */
  familyMemberOptions: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  /** Entities offered as account owners in the same dialog. */
  entityOptions: { id: string; name: string }[];

  /**
   * The plan's resolved inflation rate (`effectiveTree.planSettings.
   * inflationRate` — already resolved to the asset-class geometric return when
   * the plan's inflation source is an asset class, not the raw column).
   * Display-only: it labels the "inflation" growth option in the quick-edit
   * drawer and `SavingsRuleDialog`. Nothing persists it; the engine re-resolves
   * the effective rate on every load. It is still worth threading — the boards
   * hard-coded 3% and told advisors on a 2.4% plan the wrong number.
   */
  resolvedInflationRate: number;
}

/**
 * Task 11 editing hooks. `HouseholdMapProps` is assembled server-side and
 * crosses the server→client boundary as plain data — functions cannot travel
 * that boundary, so these callbacks are a SEPARATE client-only type, created
 * and consumed entirely inside `household-map-view.tsx` and the boards it
 * renders. Never merge this into `HouseholdMapProps`.
 */
export interface BoardCallbacks {
  /** A card was clicked for an existing item — open the item's editor. Boards
   *  never decide which dialog opens; they just report the click. */
  onEditItem?: (item: MapItem) => void;
  /**
   * Whether THIS card can open an editor. Distinct from `canEdit`, which is a
   * permission: a row can be perfectly permitted and still not writable.
   * Synthesized `source: "policy"` premiums/income exist only in the effective
   * tree — no write route accepts their non-uuid ids — so their cards must
   * render non-interactive rather than as a button that silently does nothing.
   * Absent = every card is editable (boards render standalone in tests).
   */
  isItemEditable?: (item: MapItem) => boolean;
  /** A goal card was clicked. `expenseId` is null for a life milestone (not
   *  editable — GoalsBoard must not call this then). `presetColumn` mirrors
   *  the goal's side ("client"/"spouse"/"joint" are valid `MapColumn`s). */
  onEditGoalExpense?: (expenseId: string, presetColumn: MapColumn) => void;
  /** A band/column "+ add" placeholder was clicked (Cash Flow board). `kind`
   *  distinguishes income/expense (→ the quick-edit drawer) from savings
   *  (→ SavingsRuleDialog); `column` seeds the create-mode preset. */
  onAddFlow?: (kind: "income" | "expense" | "savings", column: MapColumn) => void;
  /** Net Worth board's per-column "+ Add" — opens AddAccountDialog in create
   *  mode. No owner/column preset: AddAccountDialog has no prop for one. */
  onAddAccount?: () => void;
}
