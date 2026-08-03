// Decision logic for migration 0229 — living expenses become a closed
// two-bucket set. Pure: no DB, no IO, no framework. `scripts/
// run-migration-0229-living-two-bucket.ts` supplies the rows and performs the
// writes; everything that *decides* lives here so it can be unit-tested
// without a database.
import {
  LIVING_CURRENT_NAME,
  LIVING_RETIREMENT_NAME,
  livingSlotRole,
  type LivingRole,
} from "./living-expenses";
import type { YearRef } from "./milestones";

/** The subset of an `expenses` row the planner needs. */
export interface LivingRowFacts {
  id: string;
  name: string;
  /** `decimal` column — arrives as a string. */
  annualAmount: string;
  isDefault: boolean;
  startYearRef: YearRef | null;
  endYearRef: YearRef | null;
  growthSource: string;
  createdAt: Date;
}

export const CANONICAL_NAME: Record<LivingRole, string> = {
  current: LIVING_CURRENT_NAME,
  retirement: LIVING_RETIREMENT_NAME,
};

/**
 * The window a canonical slot must have. Current runs `plan_start →
 * client_retirement` and Retirement runs `client_retirement → plan_end`, so
 * the Current row ends exactly where the Retirement row begins and the two can
 * never overlap.
 *
 * `spouse_retirement` is accepted as a Retirement start because
 * `livingSlotRole` already classifies it as one.
 */
export function isCanonicalWindow(
  row: Pick<LivingRowFacts, "startYearRef" | "endYearRef">,
  role: LivingRole,
): boolean {
  return role === "current"
    ? row.startYearRef === "plan_start" && row.endYearRef === "client_retirement"
    : (row.startYearRef === "client_retirement" ||
        row.startYearRef === "spouse_retirement") &&
        row.endYearRef === "plan_end";
}

/**
 * A row may be promoted into `role`'s slot only if it ALREADY has that role's
 * canonical window.
 *
 * Deliberately strict. Adoption only ever sets `is_default`; it does not move
 * year boundaries. Promoting a row whose window doesn't fit — say one running
 * `plan_start → plan_end` — would leave a Current slot that overlaps a funded
 * Retirement slot for every retirement year, double-counting the client's
 * spending. That is precisely the defect this feature exists to remove.
 *
 * Rows that don't fit fall through to reclassification, which drops the
 * scenario's living total and trips `findLivingMoneyLoss` — so the operator
 * sees a manifest and rules on it, instead of the script silently reshaping a
 * plan's year windows.
 */
export function isAdoptable(row: LivingRowFacts, role: LivingRole): boolean {
  return (
    !row.isDefault &&
    livingSlotRole(row.startYearRef) === role &&
    isCanonicalWindow(row, role)
  );
}

/** Money in whole cents — avoids float drift turning "equal" into "decreased". */
export function cents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

export interface LivingScenarioPlan {
  adopt: { row: LivingRowFacts; role: LivingRole }[];
  seed: LivingRole[];
  reclassify: LivingRowFacts[];
  rename: { row: LivingRowFacts; name: string }[];
  /** Every surviving default row not already on `inflation`. */
  forceGrowthSource: LivingRowFacts[];
  livingCentsBefore: number;
  livingCentsAfter: number;
}

/**
 * Decide what happens to one (client, scenario)'s living rows.
 *
 * Order is load-bearing: adopt-or-seed resolves each slot BEFORE anything is
 * reclassified, so a funded orphan is promoted rather than swept into `other`.
 */
export function planLivingScenario(rows: LivingRowFacts[]): LivingScenarioPlan {
  const adopt: LivingScenarioPlan["adopt"] = [];
  const seed: LivingRole[] = [];
  const adoptedIds = new Set<string>();

  for (const role of ["current", "retirement"] as const) {
    if (rows.some((r) => r.isDefault && livingSlotRole(r.startYearRef) === role)) {
      continue;
    }
    // Largest amount wins; oldest created_at breaks the tie. Deterministic, so
    // a re-run reaches the same decision.
    const candidate = rows
      .filter((r) => !adoptedIds.has(r.id) && isAdoptable(r, role))
      .sort(
        (a, b) =>
          cents(b.annualAmount) - cents(a.annualAmount) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];

    if (candidate) {
      adopt.push({ row: candidate, role });
      adoptedIds.add(candidate.id);
    } else {
      seed.push(role);
    }
  }

  const survives = (r: LivingRowFacts) => r.isDefault || adoptedIds.has(r.id);
  const survivors = rows.filter(survives);

  const rename: LivingScenarioPlan["rename"] = [];
  for (const r of survivors) {
    const role = livingSlotRole(r.startYearRef);
    if (!role) continue;
    const name = CANONICAL_NAME[role];
    if (r.name !== name) rename.push({ row: r, name });
  }

  return {
    adopt,
    seed,
    reclassify: rows.filter((r) => !survives(r)),
    rename,
    // Decoupled from the rename check on purpose. Gating growth_source on the
    // name meant only MISNAMED rows had it corrected — a projection-changing
    // edit applied to an arbitrary subset. Every surviving default living row
    // grows with inflation; the UI states that as fact in a cell the advisor
    // cannot edit (`income-expenses-view.tsx`, `LIVING_EDITABLE_FIELDS`).
    forceGrowthSource: survivors.filter((r) => r.growthSource !== "inflation"),
    livingCentsBefore: rows.reduce((n, r) => n + cents(r.annualAmount), 0),
    // Seeded slots are $0, so they add nothing.
    livingCentsAfter: survivors.reduce((n, r) => n + cents(r.annualAmount), 0),
  };
}

export interface LivingMoneyLoss {
  clientId: string;
  scenarioId: string;
  livingCentsBefore: number;
  livingCentsAfter: number;
  leaving: LivingRowFacts[];
}

/**
 * Scenarios whose living bucket would SHRINK.
 *
 * The two-bucket model has no sanctioned way for money to leave the living
 * bucket: reclassification is meant to re-file genuine extras, not to strip a
 * client's actual spending. When it would, the run must abort — `type ===
 * "living"` drives the solver's spending lever
 * (`lib/solver/lever-search-config.ts`), the life-insurance need calculation
 * (`engine/what-if/life-insurance-need.ts`) and the spending stress test
 * (`engine/projection.ts`), so a silent drop changes real advice.
 *
 * Resolving a hit is a product decision (fund the canonical slots for that
 * scenario), after which this returns empty and the migration proceeds.
 */
export function findLivingMoneyLoss(
  plans: { clientId: string; scenarioId: string; plan: LivingScenarioPlan }[],
): LivingMoneyLoss[] {
  return plans
    .filter(({ plan }) => plan.livingCentsAfter < plan.livingCentsBefore)
    .map(({ clientId, scenarioId, plan }) => ({
      clientId,
      scenarioId,
      livingCentsBefore: plan.livingCentsBefore,
      livingCentsAfter: plan.livingCentsAfter,
      leaving: plan.reclassify.filter((r) => cents(r.annualAmount) > 0),
    }));
}
