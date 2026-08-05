// Shared fixtures for the Household Map board tests.
//
// `HouseholdMapProps` carries two typed ENGINE singletons (`clientInfo`,
// `planSettings`) that every board's `baseProps` has to satisfy whether or not
// that board reads them — they exist for `SocialSecurityDialog`. Building them
// once here keeps four near-identical literals from drifting apart, and keeps a
// board test that adds a field to one of them from having to touch the others.
//
// Not a `*.test.ts` file, so vitest's default include glob does not collect it.
import type { ClientInfo, PlanSettings } from "@/engine/types";
import type { MapItem, MapPeople } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";

/** Alex + Jordan, matching the `person()` defaults the board fixtures use. */
export const TEST_CLIENT_INFO: ClientInfo = {
  firstName: "Alex",
  lastName: "Rivera",
  dateOfBirth: "1980-06-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Jordan",
  spouseDob: "1982-03-04",
  spouseRetirementAge: 65,
  filingStatus: "married_joint",
};

export const TEST_PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2075,
};

// ── Narrow board fixtures ───────────────────────────────────────────────────
// For the tests that drive `GoalsBoard` / `CashFlowBoard` through the narrow
// `GoalsBoardProps` / `CashFlowBoardProps` — the board prop-type test and the
// two read-only Organizer screen tests. All three used to declare these three
// literals verbatim; a field added to `MapPerson`, `MapItem` or `MapGoal` meant
// three files to update, and nothing kept the copies agreeing in between.
//
// Distinct from the Alex + Jordan household above on purpose: these tests care
// about a single unpartnered client, so a second person would be noise.

/** A lone client, no spouse, no children — the shape all three tests want. */
export const TEST_SOLO_PEOPLE: MapPeople = {
  client: {
    familyMemberId: "fm-1",
    firstName: "Cooper",
    age: 50,
    retirementYear: 2040,
    birthYear: 1976,
  },
  spouse: null,
  children: [],
};

/** One ordinary income card, owned by the client. */
export const TEST_INCOME_ITEM: MapItem = {
  id: "i1",
  kind: "income",
  category: "investments",
  name: "Salary",
  valueLabel: "$200,000",
  value: 200000,
  column: "client",
  splitChip: null,
  trayOwnerLabel: null,
  noteChip: null,
  timing: null,
  editableAmount: 200000,
};

/** One ordinary purchase goal, backed by a real expense id (so it is writable
 *  when the board is given a matching `expenseRows` entry, and inert when not). */
export const TEST_PURCHASE_GOAL: MapGoal = {
  id: "expense:e1",
  year: 2030,
  kind: "purchase",
  side: "joint",
  title: "New roof",
  detail: "$40,000",
  expenseId: "e1",
  forFamilyMemberName: null,
  lifeExpectancy: null,
};
