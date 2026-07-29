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
