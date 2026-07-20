// DB tests for the divorce draft service — getOrCreateDraft / upsertAllocations
// / abandonDraft / loadWorkbench. Hits the real Neon dev branch and skips
// cleanly without a DB so it never adds to the no-delta failing set in CI.
// Each test owns its world via createMarriedFixture and tears it down in
// `finally` so an assertion failure can't leak rows (destroying the client
// cascades divorce_plans → divorce_plan_allocations).
import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { divorcePlans, divorcePlanAllocations } from "@/db/schema";
import {
  getOrCreateDraft,
  upsertAllocations,
  abandonDraft,
  loadWorkbench,
  DivorcePlanError,
} from "../divorce-plans";
import { AllocationError } from "../allocation-rules";
import { computeSideTotals } from "../side-totals";
import { createMarriedFixture, destroyFixture, TEST_ADVISOR_ID } from "./fixtures";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("divorce-plans service", () => {
  it("creates a draft on a married fixture; splitYear = current year; second call returns the SAME row", async () => {
    const f = await createMarriedFixture();
    try {
      const plan = await getOrCreateDraft({
        clientId: f.clientId,
        firmId: f.firmId,
        userId: TEST_ADVISOR_ID,
      });
      expect(plan.clientId).toBe(f.clientId);
      expect(plan.status).toBe("draft");
      expect(plan.splitYear).toBe(new Date().getFullYear());

      const rowsAfterFirst = await db
        .select()
        .from(divorcePlans)
        .where(eq(divorcePlans.clientId, f.clientId));
      expect(rowsAfterFirst).toHaveLength(1);
      expect(rowsAfterFirst[0].id).toBe(plan.id);

      const plan2 = await getOrCreateDraft({
        clientId: f.clientId,
        firmId: f.firmId,
        userId: TEST_ADVISOR_ID,
      });
      expect(plan2.id).toBe(plan.id);

      const rowsAfterSecond = await db
        .select()
        .from(divorcePlans)
        .where(eq(divorcePlans.clientId, f.clientId));
      expect(rowsAfterSecond).toHaveLength(1);
    } finally {
      await destroyFixture(f);
    }
  });

  it("throws not_married on a single-filer fixture", async () => {
    const f = await createMarriedFixture({ filingStatus: "single", noSpouse: true });
    try {
      let caught: unknown;
      try {
        await getOrCreateDraft({
          clientId: f.clientId,
          firmId: f.firmId,
          userId: TEST_ADVISOR_ID,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DivorcePlanError);
      expect((caught as DivorcePlanError).code).toBe("not_married");
    } finally {
      await destroyFixture(f);
    }
  });

  it("upserts a valid split allocation and reads it back", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          {
            targetKind: "account",
            targetId: f.ids.jointBrokerage,
            disposition: "split",
            splitPercentToSpouse: 50,
          },
        ],
      });

      const rows = await db
        .select({ alloc: divorcePlanAllocations })
        .from(divorcePlanAllocations)
        .innerJoin(divorcePlans, eq(divorcePlanAllocations.divorcePlanId, divorcePlans.id))
        .where(
          and(
            eq(divorcePlans.clientId, f.clientId),
            eq(divorcePlanAllocations.targetId, f.ids.jointBrokerage),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].alloc.disposition).toBe("split");
      expect(Number(rows[0].alloc.splitPercentToSpouse)).toBe(50);
    } finally {
      await destroyFixture(f);
    }
  });

  it("upsert split-on-life-insurance throws AllocationError", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      await expect(
        upsertAllocations({
          clientId: f.clientId,
          firmId: f.firmId,
          items: [
            {
              targetKind: "account",
              targetId: f.ids.lifeInsurance,
              disposition: "split",
              splitPercentToSpouse: 50,
            },
          ],
        }),
      ).rejects.toThrow(AllocationError);
    } finally {
      await destroyFixture(f);
    }
  });

  it("abandon flips status; next getOrCreateDraft makes a FRESH draft (old allocations not resurrected)", async () => {
    const f = await createMarriedFixture();
    try {
      const plan1 = await getOrCreateDraft({
        clientId: f.clientId,
        firmId: f.firmId,
        userId: TEST_ADVISOR_ID,
      });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          {
            targetKind: "account",
            targetId: f.ids.primaryBrokerage,
            disposition: "primary",
            splitPercentToSpouse: null,
          },
        ],
      });

      await abandonDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });

      const [abandoned] = await db
        .select()
        .from(divorcePlans)
        .where(eq(divorcePlans.id, plan1.id));
      expect(abandoned.status).toBe("abandoned");

      const plan2 = await getOrCreateDraft({
        clientId: f.clientId,
        firmId: f.firmId,
        userId: TEST_ADVISOR_ID,
      });
      expect(plan2.id).not.toBe(plan1.id);
      expect(plan2.status).toBe("draft");

      const allocs = await db
        .select()
        .from(divorcePlanAllocations)
        .where(eq(divorcePlanAllocations.divorcePlanId, plan2.id));
      expect(allocs).toHaveLength(0);
    } finally {
      await destroyFixture(f);
    }
  });

  it("loadWorkbench returns totals consistent with computeSideTotals", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });

      const payload = await loadWorkbench({ clientId: f.clientId, firmId: f.firmId });
      const resolvedMap = new Map(payload.resolved);
      const expected = computeSideTotals(payload.objects, resolvedMap);

      expect(payload.totals).toEqual(expected);
      expect(payload.people.primaryName).toContain("Taylor");
      expect(payload.people.spouseName).toContain("Jordan");
    } finally {
      await destroyFixture(f);
    }
  });
});
