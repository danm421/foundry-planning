import { describe, it, expect } from "vitest";

import { derivePlanBasics } from "../../assemble/plan-basics";
import type { AssemblePlanBasics } from "../../assemble/types";
import { emptyImportPayload, type ImportPayload } from "../../types";
import { callsForTable, makeFakeTx, type FakeTx, type FakeTxCall } from "../../__tests__/commit-test-helpers";
import { commitExpenses } from "../expenses";
import { commitPlanBasics } from "../plan-basics";

/**
 * THE DOUBLE-COUNT REGRESSION.
 *
 * The extraction prompt emits living spending as separate itemized rows
 * (Housing / Groceries / Utilities). `derivePlanBasics` SUMS them into the one
 * figure the advisor reviews on Plan basics, and `commitPlanBasics` writes that
 * sum onto the seeded Current Living Expenses slot. If `commitExpenses` then
 * ALSO writes those same rows, the engine — which sums every `living` row in
 * the scenario — sees the money twice (42k on the slot + 42k of new rows = 84k),
 * and again through retirement, because an inserted row's default window runs
 * `currentYear .. currentYear + 30`.
 *
 * These tests drive BOTH commit modules against ONE payload and one fake
 * transaction, and assert on the living total the engine would then see.
 */

const CTX = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
} as const;

const CURRENT_SLOT = { id: "slot-current", startYearRef: "plan_start" };
const RETIREMENT_SLOT = { id: "slot-retirement", startYearRef: "client_retirement" };

/** Housing + Groceries + Utilities = 42,000. */
function itemizedLivingRows(): ImportPayload["expenses"] {
  return [
    { type: "living", name: "Housing", annualAmount: 24000, match: { kind: "new" } },
    { type: "living", name: "Groceries", annualAmount: 12000, match: { kind: "new" } },
    { type: "living", name: "Utilities", annualAmount: 6000, match: { kind: "new" } },
  ];
}

function payloadWith(planBasics?: AssemblePlanBasics): ImportPayload {
  return { ...emptyImportPayload(), expenses: itemizedLivingRows(), planBasics };
}

/** The figure the advisor actually reviews, built by the real derivation. */
function reviewedBasics(payload: ImportPayload): AssemblePlanBasics {
  return derivePlanBasics({
    payload,
    known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: false },
    mode: "new",
  });
}

function expenseCalls(fake: FakeTx, op: "insert" | "update"): FakeTxCall[] {
  return callsForTable(fake.calls, "expenses").filter((c) => c.op === op);
}

function amountsWritten(fake: FakeTx, op: "insert" | "update"): string[] {
  return expenseCalls(fake, op).map(
    (c) => String((c as { values: Record<string, unknown> }).values.annualAmount),
  );
}

/**
 * What the engine would sum for the current period: whatever landed on the
 * seeded Current Living Expenses slot (0 if nothing did — the slot is seeded at
 * "0"), plus every freshly-inserted `living` row, whose default window starts
 * this year. Only the current slot is seeded in these cases, so the single
 * expenses UPDATE is unambiguously that slot.
 */
function currentPeriodLivingTotal(fake: FakeTx): number {
  const written = amountsWritten(fake, "update");
  const slot = written.length > 0 ? Number(written[written.length - 1]) : 0;
  const inserted = expenseCalls(fake, "insert")
    .map((c) => (c as { values: Record<string, unknown> }).values)
    .filter((v) => v.type === "living")
    .reduce((sum, v) => sum + Number(v.annualAmount), 0);
  return slot + inserted;
}

describe("living-expense fold: the reviewed total supersedes the itemized rows", () => {
  it("commits itemized rows + plan basics as the reviewed figure EXACTLY ONCE", async () => {
    const payload = payloadWith();
    const basics = reviewedBasics(payload);
    expect(basics.currentLivingSpending.value).toBe(42000); // 24k + 12k + 6k

    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);
    const reviewed = payloadWith(basics);

    await commitPlanBasics(fake.tx, reviewed, CTX);
    const expensesResult = await commitExpenses(fake.tx, reviewed, CTX);

    expect(currentPeriodLivingTotal(fake)).toBe(42000);
    expect(expenseCalls(fake, "insert")).toHaveLength(0);
    expect(expensesResult.created).toBe(0);
    // Not an error — accounted for the way deliberately-unwritten fuzzy rows are.
    expect(expensesResult.skipped).toBe(3);
    expect(expensesResult.warnings).toEqual([
      "3 extracted living-expense rows were folded into the reviewed living-expense " +
        "total on Plan basics and not written as separate expense rows.",
    ]);
  });

  it("is order-independent — the wizard commits one tab per click, in either order", async () => {
    const reviewed = payloadWith(reviewedBasics(payloadWith()));

    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);
    await commitExpenses(fake.tx, reviewed, CTX); // expenses tab clicked FIRST
    await commitPlanBasics(fake.tx, reviewed, CTX);

    expect(currentPeriodLivingTotal(fake)).toBe(42000);
    expect(expenseCalls(fake, "insert")).toHaveLength(0);
  });

  it("does not double-count through retirement either", async () => {
    const reviewed = payloadWith(reviewedBasics(payloadWith()));

    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT, RETIREMENT_SLOT]);
    await commitPlanBasics(fake.tx, reviewed, CTX);
    await commitExpenses(fake.tx, reviewed, CTX);

    // Exactly two writes: the reviewed current figure and the derived
    // retirement figure (80% of it), each on its own slot. No itemized row is
    // inserted with a currentYear+30 window to run alongside them.
    expect(amountsWritten(fake, "update")).toEqual(["42000", "33600"]);
    expect(expenseCalls(fake, "insert")).toHaveLength(0);
  });

  it("suppresses a row matched onto the slot itself, so the reviewed total is not clobbered", async () => {
    // An extracted "Total Living Expenses" line matches the seeded slot exactly.
    // commitExpenses runs AFTER commitPlanBasics in COMMIT_TABS order, so
    // writing it would overwrite the reviewed total on the canonical row.
    const basics = reviewedBasics(payloadWith());
    const reviewed: ImportPayload = {
      ...emptyImportPayload(),
      expenses: [
        {
          type: "living",
          name: "Total Living Expenses",
          annualAmount: 30000,
          match: { kind: "exact", existingId: CURRENT_SLOT.id },
        },
      ],
      planBasics: basics,
    };

    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);
    await commitPlanBasics(fake.tx, reviewed, CTX);
    const expensesResult = await commitExpenses(fake.tx, reviewed, CTX);

    expect(amountsWritten(fake, "update")).toEqual(["42000"]);
    expect(expensesResult.updated).toBe(0);
  });
});

describe("living-expense fold: the guard — blank never loses the spending", () => {
  it("still inserts every itemized row when the payload carries no planBasics", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);
    const bare = payloadWith(); // planBasics absent

    await commitPlanBasics(fake.tx, bare, CTX);
    const expensesResult = await commitExpenses(fake.tx, bare, CTX);

    expect(expensesResult.created).toBe(3);
    expect(expensesResult.warnings).toEqual([]);
    expect(currentPeriodLivingTotal(fake)).toBe(42000);
  });

  it("still inserts every itemized row when the advisor cleared the figure", async () => {
    const basics = reviewedBasics(payloadWith());
    const cleared: AssemblePlanBasics = {
      ...basics,
      currentLivingSpending: { value: null, provenance: "stated" },
      retirementLivingSpending: { value: null, provenance: "stated" },
    };
    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);
    const reviewed = payloadWith(cleared);

    await commitPlanBasics(fake.tx, reviewed, CTX);
    const expensesResult = await commitExpenses(fake.tx, reviewed, CTX);

    // Nothing was written to the slot, so the rows are the ONLY record of the
    // spending — losing them would be worse than double counting them.
    expect(expenseCalls(fake, "update")).toHaveLength(0);
    expect(expensesResult.created).toBe(3);
    expect(currentPeriodLivingTotal(fake)).toBe(42000);
  });

  it("still inserts every itemized row when there is no seeded slot at all", async () => {
    const reviewed = payloadWith();
    const basics = reviewedBasics(reviewed);
    const fake = makeFakeTx();
    fake.setSelectResult("expenses", []); // household has no isDefault living slot

    await commitPlanBasics(fake.tx, { ...reviewed, planBasics: basics }, CTX);
    const expensesResult = await commitExpenses(fake.tx, { ...reviewed, planBasics: basics }, CTX);

    // The figure is non-null, so the fold WANTS to fire — but there is nowhere
    // for commitPlanBasics to have written it. Folding here would erase the
    // spending entirely, which is strictly worse than double-counting it.
    expect(expenseCalls(fake, "update")).toHaveLength(0);
    expect(expensesResult.created).toBe(3);
    expect(currentPeriodLivingTotal(fake)).toBe(42000);
  });

  it("still inserts every itemized row when the slot predates the startYearRef backfill", async () => {
    const reviewed = payloadWith();
    const basics = reviewedBasics(reviewed);
    const fake = makeFakeTx();
    // Migration 0012 added start_year_ref with NO backfill, so a slot seeded
    // before it classifies as neither current nor retirement — commitPlanBasics
    // skips it rather than guessing, so the fold must stand down too.
    fake.setSelectResult("expenses", [{ id: "slot-legacy", startYearRef: null }]);

    await commitPlanBasics(fake.tx, { ...reviewed, planBasics: basics }, CTX);
    const expensesResult = await commitExpenses(fake.tx, { ...reviewed, planBasics: basics }, CTX);

    expect(expenseCalls(fake, "update")).toHaveLength(0);
    expect(expensesResult.created).toBe(3);
    expect(currentPeriodLivingTotal(fake)).toBe(42000);
  });

  it("never suppresses a non-living row", async () => {
    const basics = reviewedBasics(payloadWith());
    const reviewed: ImportPayload = {
      ...emptyImportPayload(),
      expenses: [
        ...itemizedLivingRows(),
        { type: "other", name: "Travel", annualAmount: 9000, match: { kind: "new" } },
      ],
      planBasics: basics,
    };
    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);

    const expensesResult = await commitExpenses(fake.tx, reviewed, CTX);

    expect(expensesResult.created).toBe(1);
    expect(amountsWritten(fake, "insert")).toEqual(["9000"]);
  });
});
