// src/lib/household-map/types.ts
import type { LifeExpectancyOwner, MapGoal } from "./goals";
import type {
  AccountViewEngineFields,
  ExpenseView,
  IncomeView,
  SavingsRuleView,
} from "@/lib/scenario/view-adapters";
import type { AccountRow } from "@/components/balance-sheet-view";
import type { GrowthContext } from "@/lib/investments/growth-context";
import type { AccountPatch } from "./account-write";
import type { CategoryDefaultRateMap } from "@/lib/investments/category-default-rates";

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

/**
 * The projection window of a cash-flow row, for the Cash Flow board's timing
 * column.
 *
 * `startYear`/`endYear` are the RESOLVED years the engine actually projects
 * with — `resolvedStart`/`resolvedEnd` in `lib/projection/load-client-data.ts`
 * have already applied any milestone ref — so they are safe to render on their
 * own. The refs ride along only to NAME the anchor in the cell's tooltip
 * ("Client Retirement (2035)"); nothing re-resolves them client-side.
 */
export interface FlowTiming {
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
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
  /** The row's projection window, or null for kinds that have none — an account
   *  or liability is a balance, not a flow. */
  timing: FlowTiming | null;
  /**
   * The POSITIVE annual figure the Cash Flow board's inline editor writes back,
   * or null when there is no single number to edit.
   *
   * Deliberately unsigned, and deliberately NOT `value`. `value` is signed so
   * band subtotals net out (an expense is negative) while the persisted
   * `annualAmount` column is unsigned — writing `value` back would flip the sign
   * of every outflow on the board.
   *
   * Null for accounts and liabilities (the Net Worth board edits those through
   * `accountRows`), and null for any savings rule whose contribution resolves to
   * a RULE rather than a dollar figure — IRS max, percent-of-pay, custom
   * schedule. Those show the rule in `valueLabel`, and offering a number editor
   * for a figure the engine will overrule is worse than offering none.
   * `resolveSavings` owns that call, so the two cannot disagree.
   */
  editableAmount: number | null;
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
  /**
   * flow id → the field set a SCENARIO edit of that flow must send, already
   * pruned by `buildFlowScenarioFields` (`lib/household-map/flow-write.ts`).
   * Present for exactly the ids that have a hydration entry above — the
   * income/expense/savings rows the Map is allowed to write.
   *
   * Why the WHOLE field set and not just the changed field: `applyEntityEdit`
   * stores `payload: diff` through `onConflictDoUpdate`, a wholesale replace, and
   * `buildFieldDiff` only emits keys the caller actually sent. A narrow
   * `{ annualAmount }` write against a flow that ALSO carries an endYear override
   * in that scenario deletes the endYear override — silently; the year just
   * reverts to base on the next render. Sending everything makes the new payload
   * "every override this scenario already had, plus the new amount".
   *
   * Why the raw engine row and not `IncomeView`/`ExpenseView`/`SavingsRuleView`:
   * those three are strict SUBSETS of the engine rows, and the gaps are
   * load-bearing. `ExpenseView` carries no `endsAtMedicareEligibilityOwner` (so a
   * view-sourced payload would drop the flag that stops a pre-Medicare health
   * expense double-counting against modeled Medicare premiums) and
   * `SavingsRuleView` carries no `fundFromExpenseReduction` — which the Solver
   * writes. Diffing the effective engine row against base cannot miss a field by
   * construction, and cannot drift when the engine type gains one.
   */
  flowScenarioFields: Record<string, Record<string, unknown>>;
  /** Every account, for `SavingsRuleDialog`'s target picker (it filters
   *  eligibility itself via `isSavingsEligibleAccount`). Engine fields only —
   *  a superset of the `{id, name, category, subType, ownerEntityId}` the
   *  picker reads. */
  accountOptions: AccountViewEngineFields[];

  /**
   * The scenario-effective `client` singleton, pruned by
   * `pruneScenarioFields`, for the Goals board's life-expectancy editor.
   *
   * Same rule as `flowScenarioFields` and for the same reason: a scenario edit's
   * payload is a wholesale replace, so it must carry every field this scenario
   * already overrides. A narrow `{ lifeExpectancy }` write against a scenario the
   * Solver built ("retire at 62") would delete the `retirementAge` override.
   */
  clientScenarioFields: Record<string, unknown>;
  /**
   * The scenario-effective `planSettings` singleton, pruned the same way.
   *
   * Needed because life expectancy is the one field on this page that moves the
   * PLAN HORIZON, and the horizon lives on two different singletons: `planEndAge`
   * on `client`, `planEndYear` on `plan_settings`. A `scenario_change` row targets
   * one kind, so a scenario-mode life-expectancy edit is two rows — see
   * `lib/household-map/life-expectancy-write.ts`.
   */
  planSettingsScenarioFields: Record<string, unknown>;

  /**
   * The COMPLETE per-account row, keyed by id — engine fields merged with
   * scenario-overlaid view-only metadata (`lib/accounts/load-account-rows.ts`).
   *
   * Distinct from `accountOptions`, which is `accountEngineToView` — a
   * documented PARTIAL that drops `growthSource` / `modelPortfolioId`. Anything
   * reading or writing growth must use THIS map, not that array.
   *
   * Load-bearing for three things: the rate shown on each card, the full field
   * set a scenario write must carry (see `lib/household-map/account-write.ts`),
   * and hydrating the real account dialog via `accountToInitial`.
   *
   * Liabilities are absent by construction. Life-insurance rows are present but
   * out of scope — boards gate on `growthEditModeFor(category)`.
   */
  accountRows: Record<string, AccountRow>;

  /** Model portfolios, fund portfolios, per-category defaults and the resolved
   *  inflation rate — the labels the growth dropdown renders. Same shape
   *  `loadImportGrowthContext` returns.
   *
   *  NAMING TRAP: `growthContext.categoryDefaults` is
   *  `Record<string, {portfolioName, blendedReturnPct}>` — display labels. It is
   *  NOT the `categoryDefaultRates` map (a `Record<string, string>` of raw
   *  rates) that Task 7 adds. Different shape, different purpose, similar name. */
  growthContext: GrowthContext;

  /**
   * Per-category default growth rate as a DECIMAL STRING, e.g.
   * `categoryDefaultRates("retirement")` -> "0.062". Covers all ten account
   * categories, and already collapses each category's configured source
   * (inflation / model portfolio / flat custom) down to one effective rate —
   * `lib/investments/category-default-rates.ts`, shared with the Net Worth page
   * so the two cannot drift.
   *
   * NAMING TRAP: this is NOT `growthContext.categoryDefaults`. That one is
   * `Record<string, {portfolioName, blendedReturnPct}>` — display labels for
   * three categories only. Similar name, different shape, different coverage.
   */
  categoryDefaultRates: CategoryDefaultRateMap;

  /** Remaining `AddAccountDialog` edit-mode context. Create mode only needed
   *  `familyMemberOptions` + `entityOptions`; editing an EXISTING row needs the
   *  growth dropdown's full vocabulary too, or a saved edit writes the form's
   *  defaults over real values. */
  // Shapes mirror what `net-worth-content.tsx` already builds for the same
  // dialog: `geometricReturn` and `weight` are PARSED numbers, and the asset
  // class carries its `slug`. The plan's snippet had all three as raw Drizzle
  // strings without the slug, which `AddAccountDialog` rejects.
  assetClassOptions: { id: string; name: string; slug: string | null; geometricReturn: number }[];
  portfolioAllocationsMap: Record<string, { assetClassId: string; weight: number }[]>;
  /** The portfolio NAME backing each category's default, for the dialog's
   *  "Plan default" label. Derived from `growthContext.categoryDefaults`, which
   *  is the right source for it — the dialog wants the name, not the rate. */
  categoryDefaultSources: Record<
    string,
    { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }
  >;
  /** Top-level business accounts, offered as a parent when re-parenting. */
  businessOptions: { id: string; name: string }[];
  /** Roth IRA accounts, for the 529 Roth-rollover target picker. */
  rothIraAccountOptions: { id: string; name: string }[];

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
  /** Persist a narrow change to one account. The board reports WHAT changed;
   *  `household-map-view` decides how it is written (base vs scenario payload —
   *  see `lib/household-map/account-write.ts`). Resolves false on failure so the
   *  editor can revert. */
  onSaveAccountField?: (accountId: string, patch: AccountPatch) => Promise<boolean>;
  /** The card's pencil was clicked — open the full account editor. */
  onEditAccount?: (accountId: string) => void;
  /**
   * Persist an inline annual-amount edit on an income / expense / savings row.
   * `next` is the POSITIVE annual figure — see `MapItem.editableAmount`; the
   * board never hands back a signed value even though outflow cards render in
   * accounting parens. Resolves false on failure so the editor can revert.
   */
  onSaveFlowAmount?: (item: MapItem, next: number) => Promise<boolean>;
  /**
   * Persist an inline life-expectancy edit from a Goals board milestone card.
   * `age` is the person's age at death, the same units the `clients` columns and
   * the Solver's sliders use — never a calendar year. Resolves false when the
   * write fails OR when the age is out of range, so the editor reverts either
   * way. Absent = the board renders the age as plain text.
   */
  onSaveLifeExpectancy?: (owner: LifeExpectancyOwner, age: number) => Promise<boolean>;
}
