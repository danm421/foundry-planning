// The two-bucket living-expense model, defined exactly once.
//
// `type: "living"` is a CLOSED SET of two rows per (client, scenario): a
// Current row anchored to `plan_start` and a Retirement row anchored to
// `client_retirement`. They are seeded by `lib/clients/create-client.ts`,
// flagged `is_default`, and cannot be created, deleted, renamed or retyped.
//
// Role is derived STRUCTURALLY from `start_year_ref`, never from the name.
// `commit/plan-basics.ts` documents why: the name was historically a free-text
// field an advisor could edit, so a substring test would silently mis-route or
// drop a write the moment a slot got renamed.
import type { ClientMilestones, YearRef } from "@/lib/milestones";

export const LIVING_CURRENT_NAME = "Current Living Expenses";
export const LIVING_RETIREMENT_NAME = "Retirement Living Expenses";

export type LivingRole = "current" | "retirement";

/** Classify a seeded living slot by its start milestone. */
export function livingSlotRole(startYearRef: YearRef | null): LivingRole | null {
  if (startYearRef === "plan_start") return "current";
  if (startYearRef === "client_retirement" || startYearRef === "spouse_retirement") {
    return "retirement";
  }
  return null;
}

/**
 * True when the Current row should be hidden from the UI.
 *
 * The Current row's window ENDS at `client_retirement`. Once that milestone is
 * at or before plan start the window is empty and the row contributes $0 to
 * every projection, so showing it is noise. Deliberately keyed on the CLIENT's
 * retirement and not on both spouses' — the row's own end anchor is
 * `client_retirement`, so this test is exactly "can this row still contribute".
 */
export function isCurrentLivingHidden(
  milestones: ClientMilestones,
  planStartYear: number,
): boolean {
  return milestones.clientRetirement <= planStartYear;
}

/**
 * The only fields an advisor may change on a default living row. The write
 * core (`lib/clients/expenses-writes.ts`) rejects anything else with a 400.
 * Year-by-year schedule overrides live in their own table and route and are
 * unaffected.
 */
export const LIVING_EDITABLE_FIELDS: ReadonlySet<string> = new Set([
  "annualAmount",
  "startYear",
  "endYear",
  "startYearRef",
  "endYearRef",
]);
