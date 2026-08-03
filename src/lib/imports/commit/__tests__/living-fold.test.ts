import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clients, crmHouseholds, expenses } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";

import { derivePlanBasics, emptyPlanBasics } from "../../assemble/plan-basics";
import type { AssemblePlanBasics } from "../../assemble/types";
import { emptyImportPayload, type ImportPayload } from "../../types";
import { callsForTable, makeFakeTx, type FakeTx, type FakeTxCall } from "../../__tests__/commit-test-helpers";
import { commitExpenses } from "../expenses";
import { commitPlanBasics } from "../plan-basics";
import { retirementSlotIdsFromPayload, sumExtractedLivingByRole } from "@/lib/imports/living-rows";

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
      "3 extracted living-expense rows were totalled into the Current and Retirement " +
        "living-expense rows on Plan basics and not written as separate expense rows.",
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

/**
 * The fold used to be CONDITIONAL: it only fired when a reviewed figure existed
 * AND a classifiable Current slot existed to receive it, because otherwise the
 * itemized rows were the only record of the spending and had to be inserted.
 *
 * That guard is gone, and these cases pin why. `type: "living"` is now a closed
 * two-row set, so there is no longer an "insert it instead" branch to fall back
 * to — a third living row cannot exist. Each case below is one arm of the
 * deleted condition, and every one of them now folds. The commit result says
 * so, so nothing disappears silently.
 */
describe("living-expense fold: unconditional — there is no insert branch to fall back to", () => {
  const FOLDED_3 =
    "3 extracted living-expense rows were totalled into the Current and Retirement " +
    "living-expense rows on Plan basics and not written as separate expense rows.";

  it("folds even when the payload carries no planBasics", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("expenses", [CURRENT_SLOT]);
    const bare = payloadWith(); // planBasics absent

    await commitPlanBasics(fake.tx, bare, CTX);
    const expensesResult = await commitExpenses(fake.tx, bare, CTX);

    expect(expensesResult.created).toBe(0);
    expect(expensesResult.skipped).toBe(3);
    expect(expensesResult.warnings).toEqual([FOLDED_3]);
    expect(expenseCalls(fake, "insert")).toHaveLength(0);
  });

  it("folds even when the advisor cleared the figure", async () => {
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

    // A cleared figure commits as no-change, so the slot keeps its seeded $0
    // and the itemized detail is not resurrected as rows. The advisor blanked
    // the field on purpose; the warning tells them what that cost.
    expect(expenseCalls(fake, "update")).toHaveLength(0);
    expect(expensesResult.created).toBe(0);
    expect(expensesResult.warnings).toEqual([FOLDED_3]);
    expect(currentPeriodLivingTotal(fake)).toBe(0);
  });

  it("folds even when there is no seeded slot at all", async () => {
    const reviewed = payloadWith();
    const basics = reviewedBasics(reviewed);
    const fake = makeFakeTx();
    fake.setSelectResult("expenses", []); // household has no isDefault living slot

    await commitPlanBasics(fake.tx, { ...reviewed, planBasics: basics }, CTX);
    const expensesResult = await commitExpenses(fake.tx, { ...reviewed, planBasics: basics }, CTX);

    // Migration 0229 (Task 9) adopts or seeds both slots for every scenario, so
    // this state does not survive the branch — but even here the answer is
    // fold, because inserting a living row is no longer legal.
    expect(expenseCalls(fake, "update")).toHaveLength(0);
    expect(expensesResult.created).toBe(0);
    expect(expensesResult.warnings).toEqual([FOLDED_3]);
  });

  it("folds even when the slot predates the startYearRef backfill", async () => {
    const reviewed = payloadWith();
    const basics = reviewedBasics(reviewed);
    const fake = makeFakeTx();
    // Migration 0012 added start_year_ref with NO backfill, so a slot seeded
    // before it classifies as neither current nor retirement. commitPlanBasics
    // still skips it rather than guessing — but the fold no longer follows that
    // classifier, because it has no second option.
    fake.setSelectResult("expenses", [{ id: "slot-legacy", startYearRef: null }]);

    await commitPlanBasics(fake.tx, { ...reviewed, planBasics: basics }, CTX);
    const expensesResult = await commitExpenses(fake.tx, { ...reviewed, planBasics: basics }, CTX);

    expect(expenseCalls(fake, "update")).toHaveLength(0);
    expect(expensesResult.created).toBe(0);
    expect(expensesResult.warnings).toEqual([FOLDED_3]);
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

function payloadWithSlots(): ImportPayload {
  return {
    ...emptyImportPayload(),
    expenseSlots: [
      { id: "slot-current", name: "Living Expenses", role: "current" },
      { id: "slot-retirement", name: "Retirement Living Expenses", role: "retirement" },
    ],
  };
}

describe("F3 — phase-aware living-row split", () => {
  it("excludes a row matched to the retirement slot from the current-spending sum", () => {
    const payload = payloadWithSlots();
    payload.expenses = [
      { type: "living", name: "Living Expenses", annualAmount: 60000,
        match: { kind: "exact", existingId: "slot-current" } },
      { type: "living", name: "Retirement Living Expenses", annualAmount: 48000,
        match: { kind: "exact", existingId: "slot-retirement" } },
    ];

    expect(retirementSlotIdsFromPayload(payload)).toEqual(new Set(["slot-retirement"]));
    // The figure the advisor reviews is 60000, not 108000 — and the retirement
    // row is not merely excluded, it lands in the retirement bucket.
    expect(sumExtractedLivingByRole(payload)).toEqual({
      current: { total: 60000, count: 1 },
      retirement: { total: 48000, count: 1 },
    });
  });

  it("treats a payload with no slot roles as all-current (back-compat)", () => {
    const payload = emptyImportPayload();
    payload.expenses = [
      { type: "living", name: "Housing", annualAmount: 24000, match: { kind: "new" } },
    ];
    expect(retirementSlotIdsFromPayload(payload).size).toBe(0);
    expect(sumExtractedLivingByRole(payload)).toEqual({
      current: { total: 24000, count: 1 },
      retirement: null,
    });
  });
});

/**
 * DB-BACKED SECTION. Hits the dev Neon branch (run with `--testTimeout=30000`).
 *
 * The fake-tx harness above records only the VALUES of each write, not the row
 * it targeted, so it cannot answer "what does this slot actually hold when both
 * tabs have committed" or tell a fold apart from an update of an existing row.
 * These tests seed a real client/scenario and assert on the rows that land in
 * the DB.
 */
const seededFirmIds: string[] = [];

afterAll(async () => {
  for (const firmId of seededFirmIds) {
    const rows = await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, firmId));
    for (const c of rows) {
      await db.delete(clients).where(eq(clients.id, c.id)); // cascades to expenses
    }
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
  }
});

/**
 * Seeds a client + base-case scenario with:
 *   - a seeded `isDefault` Current Living Expenses slot (`startYearRef:
 *     "plan_start"`), and
 *   - a LEGACY non-slot living-expense row ("Housing") at `annualAmount`,
 *     standing in for a row extraction matched exactly onto an existing DB
 *     row. Migration 0229 (Task 9) reclassifies these, so this shape only
 *     exists on scenarios the migration has not yet touched.
 */
async function seedClientWithLivingRow(
  opts: { annualAmount: string },
): Promise<{ clientId: string; scenarioId: string; currentSlotId: string; existingRowId: string }> {
  const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
  seededFirmIds.push(firmId);
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
  const currentYear = new Date().getUTCFullYear();

  const [slot] = await db
    .insert(expenses)
    .values({
      clientId,
      scenarioId,
      type: "living",
      name: "Living Expenses",
      annualAmount: "0",
      startYear: currentYear,
      endYear: currentYear + 30,
      startYearRef: "plan_start",
      isDefault: true,
      source: "manual",
    })
    .returning();

  const [row] = await db
    .insert(expenses)
    .values({
      clientId,
      scenarioId,
      type: "living",
      name: "Housing",
      annualAmount: opts.annualAmount,
      startYear: currentYear,
      endYear: currentYear + 30,
      isDefault: false,
      source: "extracted",
    })
    .returning();

  return { clientId, scenarioId, currentSlotId: slot.id, existingRowId: row.id };
}

/**
 * Seeds a client + base-case scenario carrying the full closed set: a Current
 * slot anchored to `plan_start` and a Retirement slot anchored to
 * `client_retirement`, both `isDefault` and both seeded at $0.
 */
async function seedClientWithBothSlots(): Promise<{
  clientId: string;
  scenarioId: string;
  firmId: string;
  currentSlotId: string;
  retirementSlotId: string;
}> {
  const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
  seededFirmIds.push(firmId);
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
  const currentYear = new Date().getUTCFullYear();

  const [current] = await db
    .insert(expenses)
    .values({
      clientId,
      scenarioId,
      type: "living",
      name: "Current Living Expenses",
      annualAmount: "0",
      startYear: currentYear,
      endYear: currentYear + 20,
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
      isDefault: true,
      source: "manual",
    })
    .returning();

  const [retirement] = await db
    .insert(expenses)
    .values({
      clientId,
      scenarioId,
      type: "living",
      name: "Retirement Living Expenses",
      annualAmount: "0",
      startYear: currentYear + 20,
      endYear: currentYear + 40,
      startYearRef: "client_retirement",
      endYearRef: "plan_end",
      isDefault: true,
      source: "manual",
    })
    .returning();

  return { clientId, scenarioId, firmId, currentSlotId: current.id, retirementSlotId: retirement.id };
}

/**
 * THE THREE-ROW DOCUMENT, and the silent money-loss it used to cause.
 *
 * "Living Expenses" 100k + "Retirement Living Expenses" 40k + "Retirement
 * Spending Need" 20k. `match.ts`'s `claimOnce` lets each seeded slot be claimed
 * exactly ONCE, so row 2 takes the retirement slot (`kind: "exact"`) and row 3
 * falls through the slot matcher to `{ kind: "new" }`.
 *
 * `sumExtractedLivingByRole` banks rows 2 AND 3 in the retirement bucket — row 2
 * by link, row 3 by name — so the figure the advisor reviews is 60k, and
 * `commitPlanBasics` writes 60k onto the retirement slot.
 *
 * Before the closed set, `commitExpenses` ALSO wrote row 2's own 40k onto that
 * same slot: row 2 is retirement-LINKED, so the old fold predicate returned
 * false for it and it fell through to the UPDATE branch. The wizard commits one
 * tab per click IN EITHER ORDER, so with Plan basics committed first the slot
 * ended at 40k and row 3's 20k was gone entirely — folded out of the insert
 * path and summed into a total that got overwritten. Losing spending is the
 * failure this codebase rates as worse than double-counting.
 *
 * The fix: `commitPlanBasics` is the SINGLE writer of both slot amounts.
 */
function threeRowDocument(currentSlotId: string, retirementSlotId: string): ImportPayload {
  return {
    ...emptyImportPayload(),
    expenseSlots: [
      { id: currentSlotId, name: "Current Living Expenses", role: "current" },
      { id: retirementSlotId, name: "Retirement Living Expenses", role: "retirement" },
    ],
    expenses: [
      {
        type: "living",
        name: "Living Expenses",
        annualAmount: 100000,
        match: { kind: "exact", existingId: currentSlotId },
      },
      {
        type: "living",
        name: "Retirement Living Expenses",
        annualAmount: 40000,
        match: { kind: "exact", existingId: retirementSlotId },
      },
      // The retirement slot is already claimed, so this one cannot link to it.
      { type: "living", name: "Retirement Spending Need", annualAmount: 20000, match: { kind: "new" } },
    ],
  };
}

describe("the assemble↔commit seam: each living slot has exactly ONE writer", () => {
  it("banks the unlinked third row in the retirement total the advisor reviews", () => {
    const doc = threeRowDocument("slot-current", "slot-retirement");

    expect(sumExtractedLivingByRole(doc)).toEqual({
      current: { total: 100000, count: 1 },
      retirement: { total: 60000, count: 2 }, // 40k by link + 20k by name
    });
    const basics = reviewedBasics(doc);
    expect(basics.currentLivingSpending.value).toBe(100000);
    expect(basics.retirementLivingSpending.value).toBe(60000);
  });

  it.each(["basics-first", "expenses-first"] as const)(
    "leaves the retirement slot carrying the whole 60,000 — %s",
    async (order) => {
      const seeded = await seedClientWithBothSlots();
      const doc = threeRowDocument(seeded.currentSlotId, seeded.retirementSlotId);
      const reviewed: ImportPayload = { ...doc, planBasics: reviewedBasics(doc) };
      const commitCtx = {
        clientId: seeded.clientId,
        scenarioId: seeded.scenarioId,
        orgId: seeded.firmId,
        userId: "user-1",
      };

      const expensesResult = await db.transaction(async (tx) => {
        if (order === "basics-first") {
          await commitPlanBasics(tx, reviewed, commitCtx);
          return commitExpenses(tx, reviewed, commitCtx);
        }
        const res = await commitExpenses(tx, reviewed, commitCtx);
        await commitPlanBasics(tx, reviewed, commitCtx);
        return res;
      });

      const rows = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.clientId, seeded.clientId), eq(expenses.type, "living")));
      const byId = new Map(rows.map((r) => [r.id, Number(r.annualAmount)]));

      // Still exactly two living rows: the closed set is not widened.
      expect(rows).toHaveLength(2);
      // 40k (linked row) + 20k (row the claimed slot pushed out) — intact, and
      // written once, by commitPlanBasics.
      expect(byId.get(seeded.retirementSlotId)).toBe(60000);
      expect(byId.get(seeded.currentSlotId)).toBe(100000);
      // commitExpenses wrote nothing at all: three living rows, all folded.
      expect(expensesResult).toMatchObject({ created: 0, updated: 0, skipped: 3 });
    },
  );
});

describe("the fold reaches the UPDATE branch too, not just the insert branch", () => {
  it("does not write an extracted living row onto an existing living row it matched", async () => {
    // Arrange: a client whose scenario still has a LEGACY non-slot living row
    // at 30000, and an import payload whose extracted row EXACTLY matches it at
    // 36000. An exact match takes the UPDATE branch, so this is the case that
    // proves the guard sits ABOVE both branches and not just above the insert.
    const { clientId, scenarioId, currentSlotId, existingRowId } =
      await seedClientWithLivingRow({ annualAmount: "30000" });
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      planBasics: { ...emptyPlanBasics(), currentLivingSpending: { value: 90000, provenance: "stated" } },
      expenseSlots: [{ id: currentSlotId, name: "Living Expenses", role: "current" }],
      expenses: [
        {
          type: "living",
          name: "Housing",
          annualAmount: 36000,
          match: { kind: "exact", existingId: existingRowId },
        },
      ],
    };

    const result = await db.transaction((tx) =>
      commitExpenses(tx, payload, { clientId, scenarioId, orgId: "org-1", userId: "user-1" }),
    );

    // Folded, not updated. The row's 36000 is already inside the bucket total
    // `commitPlanBasics` writes onto the slot, so writing it here as well would
    // put the same money in the engine's living sum twice.
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    const [row] = await db.select().from(expenses).where(eq(expenses.id, existingRowId));
    expect(Number(row.annualAmount)).toBe(30000); // untouched
  });

  it("folds a brand-new row that fed the reviewed total", async () => {
    const { clientId, scenarioId, currentSlotId } =
      await seedClientWithLivingRow({ annualAmount: "30000" });
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      planBasics: { ...emptyPlanBasics(), currentLivingSpending: { value: 90000, provenance: "stated" } },
      expenseSlots: [{ id: currentSlotId, name: "Living Expenses", role: "current" }],
      expenses: [{ type: "living", name: "Groceries", annualAmount: 12000, match: { kind: "new" } }],
    };

    const result = await db.transaction((tx) =>
      commitExpenses(tx, payload, { clientId, scenarioId, orgId: "org-1", userId: "user-1" }),
    );

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings.join(" ")).toContain(
      "totalled into the Current and Retirement living-expense rows",
    );
  });
});
