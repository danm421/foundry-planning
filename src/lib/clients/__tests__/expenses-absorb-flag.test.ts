import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { expenses, planSettings, scenarios } from "@/db/schema";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { createExpenseForClient, updateExpenseForClient } from "../expenses-writes";
import { hasAbsorbingCurrentLivingRow } from "../expenses-reads";

// Same mock as expenses-writes.test.ts: org:admin is not a STAFF_ROLE, so the
// staff-scope check short-circuits and access reduces to DB firm membership.
// vi.mock is hoisted above the consts below, so the orgId literal is inlined.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_absorb_flag",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_absorb_flag";

/** The base case's plan start year, read rather than hardcoded: every
 *  current-vs-retirement assertion below is relative to it, and a literal year
 *  silently flips meaning the moment the fixture's plan start moves. */
async function basePlanStartYear(): Promise<number> {
  const [sc] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, COOPER_CLIENT_ID), eq(scenarios.isBaseCase, true)));
  const [ps] = await db
    .select({ y: planSettings.planStartYear })
    .from(planSettings)
    .where(and(eq(planSettings.clientId, COOPER_CLIENT_ID), eq(planSettings.scenarioId, sc.id)));
  return ps.y;
}

d("expenses-writes — absorbsRemainingCashFlow", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  let planStart: number;
  beforeAll(async () => {
    planStart = await basePlanStartYear();
  });

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(expenses).where(eq(expenses.id, id));
    }
  });

  async function makeLiving(over: Record<string, unknown> = {}) {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "living",
        name: "Absorb test living",
        annualAmount: 0,
        // CURRENT living row: anchored at plan start.
        startYear: planStart,
        endYear: planStart + 10,
        ...over,
      },
    });
    if (res.ok) createdIds.push(res.data.id);
    return res;
  }

  it("persists the flag on a living row", async () => {
    const res = await makeLiving({ absorbsRemainingCashFlow: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.absorbsRemainingCashFlow).toBe(true);
  });

  it("rejects the flag on a non-living row", async () => {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Absorb test other",
        annualAmount: 0,
        startYear: 2030,
        endYear: 2040,
        absorbsRemainingCashFlow: true,
      },
    });
    // Track BEFORE asserting: if the guard regresses, the row really is created,
    // and an assertion that throws first would leak it onto the dev household.
    if (res.ok) { createdIds.push(res.data.id); }
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toBe("Only living expenses can spend the remaining cash flow.");
  });

  it("rejects a SECOND absorbing row and names the one that already has it", async () => {
    const first = await makeLiving({
      name: "Absorb test first",
      absorbsRemainingCashFlow: true,
    });
    expect(first.ok).toBe(true);

    const second = await makeLiving({
      name: "Absorb test second",
      absorbsRemainingCashFlow: true,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);
    expect(second.error).toContain("Absorb test first");
  });

  // --- Retirement living rows may absorb too ---------------------------------
  // The rule is one absorbing row per YEAR, not per plan: Current ends the year
  // before Retirement starts, so the two may both spend what is left.

  it("accepts the flag on a RETIREMENT living row (starts after plan start)", async () => {
    const res = await makeLiving({
      name: "Absorb test retirement",
      startYear: planStart + 5,
      endYear: planStart + 30,
      startYearRef: "client_retirement",
      absorbsRemainingCashFlow: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.absorbsRemainingCashFlow).toBe(true);
  });

  it("lets Current and Retirement BOTH absorb when their years don't overlap", async () => {
    const current = await makeLiving({
      name: "Absorb test current",
      startYear: planStart,
      endYear: planStart + 4,
      absorbsRemainingCashFlow: true,
    });
    expect(current.ok).toBe(true);

    const retirement = await makeLiving({
      name: "Absorb test retirement",
      startYear: planStart + 5,
      endYear: planStart + 30,
      absorbsRemainingCashFlow: true,
    });
    expect(retirement.ok).toBe(true);
  });

  it("rejects turning a row absorbing when another absorber covers any of its years", async () => {
    // The update path merges the patch onto the stored row: the patch carries
    // only the flag, so the years must come from the row already in the DB.
    const current = await makeLiving({
      name: "Absorb test long current",
      startYear: planStart,
      endYear: planStart + 10,
      absorbsRemainingCashFlow: true,
    });
    expect(current.ok).toBe(true);
    const retirement = await makeLiving({
      name: "Absorb test retirement update",
      startYear: planStart + 5,
      endYear: planStart + 30,
    });
    expect(retirement.ok).toBe(true);
    if (!retirement.ok) return;

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: retirement.data.id,
      input: { absorbsRemainingCashFlow: true },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toContain("Absorb test long current");
  });

  it("turns an EXISTING retirement row into an absorbing one", async () => {
    const created = await makeLiving({
      name: "Absorb test retirement update",
      startYear: planStart + 5,
      endYear: planStart + 30,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { absorbsRemainingCashFlow: true },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.absorbsRemainingCashFlow).toBe(true);
  });

  it("lets the absorbing row re-save itself", async () => {
    // The load-bearing case. A guard written as "does ANY absorbing row exist"
    // instead of "does any OTHER absorbing row exist" passes every test above
    // and makes the row permanently unsaveable.
    const created = await makeLiving({ absorbsRemainingCashFlow: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { absorbsRemainingCashFlow: true, annualAmount: 5000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.absorbsRemainingCashFlow).toBe(true);
  });

  it("counts only a CURRENT absorbing row as absorbing working-years surplus", async () => {
    // The read behind the presentation's flat-ladder warning: an absorbing
    // RETIREMENT row never touches the working years that chart is about.
    const [sc] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, COOPER_CLIENT_ID), eq(scenarios.isBaseCase, true)));
    const retirement = await makeLiving({
      name: "Absorb test retirement read",
      startYear: planStart + 5,
      endYear: planStart + 30,
      startYearRef: "client_retirement",
      absorbsRemainingCashFlow: true,
    });
    expect(retirement.ok).toBe(true);
    expect(await hasAbsorbingCurrentLivingRow(COOPER_CLIENT_ID, sc.id)).toBe(false);

    const current = await makeLiving({
      name: "Absorb test current read",
      startYear: planStart,
      endYear: planStart + 4,
      absorbsRemainingCashFlow: true,
    });
    expect(current.ok).toBe(true);
    expect(await hasAbsorbingCurrentLivingRow(COOPER_CLIENT_ID, sc.id)).toBe(true);
  });
});
