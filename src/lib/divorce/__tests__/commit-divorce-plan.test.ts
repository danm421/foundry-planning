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
  accounts,
  accountOwners,
  incomes,
  liabilities,
  liabilityOwners,
  beneficiaryDesignations,
  transfers,
  gifts,
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

// Teardown for a committed fixture: S client (crmHouseholdId RESTRICT) before S
// household, then the P fixture. Deleting S first SET NULLs the plan's
// resultClientId so the P-client cascade of the plan row is clean.
async function teardownCommit(f: MarriedFixture, result: CommitResult | undefined): Promise<void> {
  if (result?.spouseClientId) await db.delete(clients).where(eq(clients.id, result.spouseClientId));
  if (result?.spouseHouseholdId) await db.delete(crmHouseholds).where(eq(crmHouseholds.id, result.spouseHouseholdId));
  await destroyFixture(f);
}

// S's role='client' family member id (the re-homed ex-spouse), the owner every
// moved object collapses onto.
async function sClientFmId(spouseClientId: string): Promise<string> {
  const [fm] = await db
    .select()
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, spouseClientId), eq(familyMembers.role, "client")));
  return fm.id;
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

  it("moves the spouse 401(k) to S, collapses owners to the mover, drops the cross-side designation, follows the spouse gift + salary", async () => {
    const f = await createMarriedFixture({ withSpouseGift: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      // Every needsDecision joint object → primary; spouse401k / spouseSalary /
      // the spouse gift move automatically (spouse-owned / grantor spouse).
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

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      const sFm = await sClientFmId(result.spouseClientId);

      // 401(k) re-homed on S's base scenario.
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, f.ids.spouse401k));
      expect(acct.clientId).toBe(result.spouseClientId);
      expect(acct.scenarioId).toBe(result.spouseScenarioId);

      // Owners collapse to a single 100% row owned by S's client (the ex-spouse).
      const owners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, f.ids.spouse401k));
      expect(owners).toHaveLength(1);
      expect(owners[0].familyMemberId).toBe(sFm);
      expect(owners[0].percent).toBe("1.0000");

      // The designation naming the primary can't reach S → dropped + warned.
      const desigs = await db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.id, f.ids.spouseBeneDesignation));
      expect(desigs).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("Spouse 401(k)"))).toBe(true);

      // Spouse salary follows, owner flipped to client.
      const [inc] = await db.select().from(incomes).where(eq(incomes.id, f.ids.spouseSalary));
      expect(inc.clientId).toBe(result.spouseClientId);
      expect(inc.scenarioId).toBe(result.spouseScenarioId);
      expect(inc.owner).toBe("client");

      // Spouse gift lands on S, grantor → client, recipient remapped to S's child.
      const [gift] = await db.select().from(gifts).where(eq(gifts.id, f.spouseGiftId));
      expect(gift.clientId).toBe(result.spouseClientId);
      expect(gift.grantor).toBe("client");
      const [sChild] = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, result.spouseClientId), eq(familyMembers.role, "child")));
      expect(gift.recipientFamilyMemberId).toBe(sChild.id);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("collapses a joint liability's owners to the mover and nulls the cross-side property link", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      const sFm = await sClientFmId(result.spouseClientId);

      const [lib] = await db.select().from(liabilities).where(eq(liabilities.id, f.ids.jointMortgage));
      expect(lib.clientId).toBe(result.spouseClientId);
      expect(lib.scenarioId).toBe(result.spouseScenarioId);
      // The house stays with the primary → the secured-property link is cleared.
      expect(lib.linkedPropertyId).toBeNull();

      const owners = await db.select().from(liabilityOwners).where(eq(liabilityOwners.liabilityId, f.ids.jointMortgage));
      expect(owners).toHaveLength(1);
      expect(owners[0].familyMemberId).toBe(sFm);
      expect(owners[0].percent).toBe("1.0000");

      expect(result.warnings.some((w) => w.includes("Home Mortgage"))).toBe(true);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("deletes a transfer that straddles the two households and records a warning", async () => {
    const f = await createMarriedFixture({ withStraddleTransfer: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      // jointBrokerage → spouse; primaryBrokerage stays with the primary (default),
      // so the Brokerage Sweep (jointBrokerage → primaryBrokerage) straddles.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      const xfers = await db.select().from(transfers).where(eq(transfers.id, f.straddleTransferId));
      expect(xfers).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("Brokerage Sweep"))).toBe(true);

      // The moved source account is on S's book.
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, f.ids.jointBrokerage));
      expect(acct.clientId).toBe(result.spouseClientId);
    } finally {
      await teardownCommit(f, result);
    }
  });
});
