// DB tests for the divorce commit engine — commitDivorcePlan. Hits the real
// Neon dev branch and skips cleanly without a DB so it never adds to the
// no-delta failing set in CI. Grows through Tasks 10–12 (moves, splits,
// cleanup); Task 9 covers the scaffold: preconditions, snapshot, mint the
// spouse side, and the family-member remap.
//
// Clerk is mocked to the test firm because the mint path routes through
// createCrmHousehold (requireOrgId) and createClientForHousehold / recordAudit
// (auth-resolved actor) — mirrors src/lib/clients/__tests__/accounts-writes.test.ts.
import { describe, it, expect, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_divorce_commit",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

import {
  divorcePlans,
  clients,
  crmHouseholds,
  familyMembers,
  scenarios,
  scenarioSnapshots,
} from "@/db/schema";
import {
  commitDivorcePlan,
  DivorceCommitError,
  type CommitResult,
} from "../commit-divorce-plan";
import { getOrCreateDraft, upsertAllocations } from "../divorce-plans";
import { createMarriedFixture, destroyFixture, type MarriedFixture } from "./fixtures";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const USER = "user_test_divorce_commit";

// Resolve every needsDecision joint object so the commit isn't blocked by
// unresolved_joint. Assigning to `primary` keeps every account/expense/
// liability on P — Task 9 only exercises the family-member remap, so the
// account-level dispositions don't need to move anything here.
async function confirmJointItems(f: MarriedFixture): Promise<void> {
  await upsertAllocations({
    clientId: f.clientId,
    firmId: f.firmId,
    items: [
      { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
      { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
      { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
      { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
    ],
  });
}

d("commitDivorcePlan", () => {
  it("throws blocked (with the blocker list) when joint items are unresolved", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      // No allocations upserted → the joint objects still needsDecision → blocked.
      let caught: unknown;
      try {
        await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DivorceCommitError);
      expect((caught as DivorceCommitError).code).toBe("blocked");
      const blockers = (caught as DivorceCommitError).blockers ?? [];
      expect(blockers.some((b) => b.code === "unresolved_joint")).toBe(true);

      // Nothing was minted and the draft is still a draft.
      const [plan] = await db
        .select()
        .from(divorcePlans)
        .where(eq(divorcePlans.clientId, f.clientId));
      expect(plan.status).toBe("draft");
    } finally {
      await destroyFixture(f);
    }
  });

  it("commits a confirmed fixture: mints S household/client/base scenario + snapshot + fm remap; second commit is rejected", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await confirmJointItems(f);

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      expect(result.spouseClientId).toBeTruthy();
      expect(result.spouseHouseholdId).toBeTruthy();
      expect(result.spouseScenarioId).toBeTruthy();
      expect(result.snapshotId).toBeTruthy();

      // ── S client: single filing, linked to the new household ──
      const [sClient] = await db.select().from(clients).where(eq(clients.id, result.spouseClientId));
      expect(sClient.filingStatus).toBe("single");
      expect(sClient.crmHouseholdId).toBe(result.spouseHouseholdId);

      // ── S household: state carried from plan.spouseState (fixture household is CA) ──
      const [sHousehold] = await db
        .select()
        .from(crmHouseholds)
        .where(eq(crmHouseholds.id, result.spouseHouseholdId));
      expect(sHousehold.state).toBe("CA");

      // ── Snapshot: named "Pre-divorce baseline", owned by P ──
      const [snap] = await db
        .select()
        .from(scenarioSnapshots)
        .where(eq(scenarioSnapshots.id, result.snapshotId));
      expect(snap.name).toBe("Pre-divorce baseline");
      expect(snap.clientId).toBe(f.clientId);

      // ── S base scenario ──
      const sBase = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.clientId, result.spouseClientId), eq(scenarios.isBaseCase, true)));
      expect(sBase).toHaveLength(1);
      expect(sBase[0].id).toBe(result.spouseScenarioId);

      // ── S role='client' family member is the ex-spouse (Jordan) ──
      const sClientFm = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, result.spouseClientId), eq(familyMembers.role, "client")));
      expect(sClientFm).toHaveLength(1);
      expect(sClientFm[0].firstName).toBe("Jordan");

      // ── Child (default duplicate) copied onto S ──
      const sChild = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, result.spouseClientId), eq(familyMembers.role, "child")));
      expect(sChild).toHaveLength(1);
      expect(sChild[0].firstName).toBe("Casey");

      // ── Plan finalized: committed + resultClientId + committedAt ──
      const [committedPlan] = await db
        .select()
        .from(divorcePlans)
        .where(eq(divorcePlans.clientId, f.clientId));
      expect(committedPlan.status).toBe("committed");
      expect(committedPlan.resultClientId).toBe(result.spouseClientId);
      expect(committedPlan.committedAt).not.toBeNull();

      // ── Second commit on the now-committed client is rejected ──
      let caught: unknown;
      try {
        await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DivorceCommitError);
      expect(["no_draft", "concurrent"]).toContain((caught as DivorceCommitError).code);
    } finally {
      // Teardown order: S client (RESTRICT) before S household; then P fixture.
      // Deleting S client SET NULLs the plan's resultClientId; deleting P client
      // (destroyFixture) cascades the plan + the P-owned snapshot.
      if (result?.spouseClientId) {
        await db.delete(clients).where(eq(clients.id, result.spouseClientId));
      }
      if (result?.spouseHouseholdId) {
        await db.delete(crmHouseholds).where(eq(crmHouseholds.id, result.spouseHouseholdId));
      }
      await destroyFixture(f);
    }
  });
});
