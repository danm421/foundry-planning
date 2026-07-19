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
  crmHouseholdContacts,
  crmHouseholdRelationships,
  familyMembers,
  scenarios,
  scenarioSnapshots,
  accounts,
  accountOwners,
  entities,
  entityOwners,
  trustSplitInterestDetails,
  externalBeneficiaries,
  incomes,
  clientDeductions,
  liabilities,
  liabilityOwners,
  notesReceivable,
  beneficiaryDesignations,
  transfers,
  gifts,
  scenarioComputeCache,
  solverMcCache,
} from "@/db/schema";
import {
  commitDivorcePlan,
  DivorceCommitError,
  type CommitResult,
} from "../commit-divorce-plan";
import * as activityModule from "@/lib/crm/activity";
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

// Net worth of a client in integer cents: Σ(accounts.value) + Σ(notes balance)
// − Σ(liabilities.balance), across every scenario the client owns (a committed
// file only has its base scenario). Integer cents so the conservation anchor is
// exact — no float drift.
async function netCents(clientId: string): Promise<number> {
  const toC = (s: string | null) => Math.round(Number(s ?? 0) * 100);
  const [accts, libs, notes] = await Promise.all([
    db.select({ v: accounts.value }).from(accounts).where(eq(accounts.clientId, clientId)),
    db.select({ b: liabilities.balance }).from(liabilities).where(eq(liabilities.clientId, clientId)),
    db
      .select({ v: notesReceivable.asOfBalance, f: notesReceivable.faceValue })
      .from(notesReceivable)
      .where(eq(notesReceivable.clientId, clientId)),
  ]);
  let cents = 0;
  for (const a of accts) cents += toC(a.v);
  for (const l of libs) cents -= toC(l.b);
  for (const n of notes) cents += toC(n.v ?? n.f);
  return cents;
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
      // Flag the moving account as the household default checking so the move's
      // dedup path executes — S must not end up with two default-checking rows.
      await db
        .update(accounts)
        .set({ isDefaultChecking: true })
        .where(eq(accounts.id, f.ids.spouse401k));

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      const sFm = await sClientFmId(result.spouseClientId);

      // 401(k) re-homed on S's base scenario, default-checking flag cleared.
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, f.ids.spouse401k));
      expect(acct.clientId).toBe(result.spouseClientId);
      expect(acct.scenarioId).toBe(result.spouseScenarioId);
      expect(acct.isDefaultChecking).toBe(false);

      // S has exactly one default-checking account — its own seeded one.
      const sChecking = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, result.spouseClientId), eq(accounts.isDefaultChecking, true)));
      expect(sChecking).toHaveLength(1);

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

  it("splits jointBrokerage 60% to the spouse: P keeps 240k/80k, a new S share holds 360k/120k, one owner per side, conserved", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "split", splitPercentToSpouse: 60 },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      const sFm = await sClientFmId(result.spouseClientId);

      // P keeps the ORIGINAL id, reduced to its 40% share, owned 100% by the primary.
      const [pAcct] = await db.select().from(accounts).where(eq(accounts.id, f.ids.jointBrokerage));
      expect(pAcct.clientId).toBe(f.clientId);
      expect(pAcct.scenarioId).toBe(f.baseScenarioId);
      expect(pAcct.value).toBe("240000.00");
      expect(pAcct.basis).toBe("80000.00");
      const pOwners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, f.ids.jointBrokerage));
      expect(pOwners).toHaveLength(1);
      expect(pOwners[0].familyMemberId).toBe(f.primaryFmId);
      expect(pOwners[0].percent).toBe("1.0000");

      // S gets a NEW row (new id) with the 60% share, owned 100% by S's client.
      const sAccts = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, result.spouseClientId), eq(accounts.name, "Joint Brokerage")));
      expect(sAccts).toHaveLength(1);
      const sAcct = sAccts[0];
      expect(sAcct.id).not.toBe(f.ids.jointBrokerage);
      expect(sAcct.scenarioId).toBe(result.spouseScenarioId);
      expect(sAcct.value).toBe("360000.00");
      expect(sAcct.basis).toBe("120000.00");
      const sOwners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, sAcct.id));
      expect(sOwners).toHaveLength(1);
      expect(sOwners[0].familyMemberId).toBe(sFm);
      expect(sOwners[0].percent).toBe("1.0000");

      // Conservation: the two shares reconstruct the original 600k / 200k exactly.
      expect(Number(pAcct.value) + Number(sAcct.value)).toBe(600000);
      expect(Number(pAcct.basis) + Number(sAcct.basis)).toBe(200000);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("duplicates the trust to S: a new entity with grantor cleared + a copied trust account; P rows untouched", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.ids.trust, disposition: "duplicate", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // P side untouched — it IS the primary's copy.
      const [pTrust] = await db.select().from(entities).where(eq(entities.id, f.ids.trust));
      expect(pTrust.clientId).toBe(f.clientId);
      expect(pTrust.grantor).toBe("client");
      expect(pTrust.isGrantor).toBe(true);
      const [pTrustAcct] = await db.select().from(accounts).where(eq(accounts.id, f.ids.trustAccount));
      expect(pTrustAcct.clientId).toBe(f.clientId);
      expect(pTrustAcct.value).toBe("300000.00");

      // S has a NEW entity — grantor cleared ('client' → null; primary isn't on S),
      // isGrantor recomputed to false. entityRemap is what wired the copied account.
      const sEntities = await db.select().from(entities).where(eq(entities.clientId, result.spouseClientId));
      expect(sEntities).toHaveLength(1);
      const sTrust = sEntities[0];
      expect(sTrust.id).not.toBe(f.ids.trust);
      expect(sTrust.name).toBe("Family Irrevocable Trust");
      expect(sTrust.grantor).toBeNull();
      expect(sTrust.isGrantor).toBe(false);

      // S has a copied trust account, values equal to P's, owned 100% by the S entity.
      const sTrustAccts = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, result.spouseClientId), eq(accounts.name, "Trust Brokerage")));
      expect(sTrustAccts).toHaveLength(1);
      expect(sTrustAccts[0].value).toBe("300000.00");
      expect(sTrustAccts[0].basis).toBe("150000.00");
      expect(sTrustAccts[0].scenarioId).toBe(result.spouseScenarioId);
      const sTrustOwners = await db
        .select()
        .from(accountOwners)
        .where(eq(accountOwners.accountId, sTrustAccts[0].id));
      expect(sTrustOwners).toHaveLength(1);
      expect(sTrustOwners[0].entityId).toBe(sTrust.id);
      expect(sTrustOwners[0].percent).toBe("1.0000");
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("moves the trust whole to the spouse: entity + owned account re-homed on S, owner collapses to the mover, grantor cleared", async () => {
    const f = await createMarriedFixture({ withTrustAccountDesignation: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.ids.trust, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      const sFm = await sClientFmId(result.spouseClientId);

      // Entity re-homed on S (same id), grantor cleared ('client' → null on the ex-spouse's file).
      const [trust] = await db.select().from(entities).where(eq(entities.id, f.ids.trust));
      expect(trust.clientId).toBe(result.spouseClientId);
      expect(trust.grantor).toBeNull();
      expect(trust.isGrantor).toBe(false);

      // Its owner collapses to the mover (S's client) — the fixture's primary owner can't reach S.
      const owners = await db.select().from(entityOwners).where(eq(entityOwners.entityId, f.ids.trust));
      expect(owners).toHaveLength(1);
      expect(owners[0].familyMemberId).toBe(sFm);
      expect(owners[0].percent).toBe("1.0000");

      // The owned account follows onto S's base scenario; its entity ownership (id unchanged) rides along.
      const [trustAcct] = await db.select().from(accounts).where(eq(accounts.id, f.ids.trustAccount));
      expect(trustAcct.clientId).toBe(result.spouseClientId);
      expect(trustAcct.scenarioId).toBe(result.spouseScenarioId);
      const acctOwners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, f.ids.trustAccount));
      expect(acctOwners).toHaveLength(1);
      expect(acctOwners[0].entityId).toBe(f.ids.trust);

      // The child account's beneficiary designation re-pointed onto S, remapped
      // to S's copy of the child (I5 — the whole move now moves child-account
      // designations, not just the entity's own).
      const [childDes] = await db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.id, f.trustAccountDesignationId));
      expect(childDes.clientId).toBe(result.spouseClientId);
      expect(childDes.accountId).toBe(f.ids.trustAccount);
      const [sChild] = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, result.spouseClientId), eq(familyMembers.role, "child")));
      expect(childDes.familyMemberId).toBe(sChild.id);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("splitting a holdings-driven account stops BOTH shares deriving from holdings, conserves stored value, and warns (Fix 1)", async () => {
    const f = await createMarriedFixture({ withHoldingsAccount: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.holdingsAccountId, disposition: "split", splitPercentToSpouse: 60 },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // P keeps the original id, 40% share, and STOPS deriving from holdings —
      // otherwise resolve-entity would re-inflate it to the full 100k.
      const [pAcct] = await db.select().from(accounts).where(eq(accounts.id, f.holdingsAccountId));
      expect(pAcct.value).toBe("40000.00");
      expect(pAcct.basis).toBe("16000.00");
      expect(pAcct.deriveFromHoldings).toBe(false);

      // S share also holdings-off (it has no holdings rows), stored value governs.
      const [sAcct] = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, result.spouseClientId), eq(accounts.name, "Managed Brokerage")));
      expect(sAcct.value).toBe("60000.00");
      expect(sAcct.basis).toBe("24000.00");
      expect(sAcct.deriveFromHoldings).toBe(false);

      expect(Number(pAcct.value) + Number(sAcct.value)).toBe(100000);
      expect(result.warnings.some((w) => w.includes("Managed Brokerage") && w.includes("holdings"))).toBe(true);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("duplicating a CRT copies its split-interest details: charity via ensureExternalBeneficiary, measuring life remapped to S (Fix 2)", async () => {
    const f = await createMarriedFixture({ withCharitableTrust: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.charitableTrustId, disposition: "duplicate", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      const sCrts = await db
        .select()
        .from(entities)
        .where(and(eq(entities.clientId, result.spouseClientId), eq(entities.trustSubType, "crt")));
      expect(sCrts).toHaveLength(1);

      const [sDetails] = await db
        .select()
        .from(trustSplitInterestDetails)
        .where(eq(trustSplitInterestDetails.entityId, sCrts[0].id));
      expect(sDetails.clientId).toBe(result.spouseClientId);

      // Measuring life (the child) remapped to S's copy of the child.
      const [sChild] = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, result.spouseClientId), eq(familyMembers.role, "child")));
      expect(sDetails.measuringLife1Id).toBe(sChild.id);

      // Charity copied onto S via ensureExternalBeneficiary (one new row, shared
      // by the split-interest FK and the remainder designation's memoized copy).
      const sCharities = await db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, result.spouseClientId));
      expect(sCharities).toHaveLength(1);
      expect(sCharities[0].name).toBe("Test Charity");
      expect(sDetails.charityId).toBe(sCharities[0].id);
      expect(sDetails.charityId).not.toBe(f.charityId);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("aborts the whole commit (DivorceCommitError) when a life-based CRT's measuring life can't reach S (Fix 2)", async () => {
    const f = await createMarriedFixture({ withCharitableTrust: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      // Retarget the single-life measuring life onto the PRIMARY, who stays on P.
      await db
        .update(trustSplitInterestDetails)
        .set({ measuringLife1Id: f.primaryFmId })
        .where(eq(trustSplitInterestDetails.entityId, f.charitableTrustId));
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.charitableTrustId, disposition: "duplicate", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      let caught: unknown;
      try {
        await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DivorceCommitError);
      expect((caught as DivorceCommitError).code).toBe("unresolvable_measuring_life");

      // Atomic rollback: plan stays draft, nothing minted, no stray S entity/charity.
      const [plan] = await db.select().from(divorcePlans).where(eq(divorcePlans.clientId, f.clientId));
      expect(plan.status).toBe("draft");
      expect(plan.resultClientId).toBeNull();
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("warns when a duplicated entity's owned account has an uncopied life-insurance/stock-option ride-along (Fix 3)", async () => {
    const f = await createMarriedFixture({ withTrustLifePolicy: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.ids.trust, disposition: "duplicate", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // Trust Brokerage copied to S, but its LI extension did NOT ride along → warned.
      expect(
        result.warnings.some((w) => w.includes("Trust Brokerage") && /life-insurance|stock-option/.test(w)),
      ).toBe(true);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("moving a CRT whole to the spouse re-points its split-interest details + remainder designation onto S (Fix 4)", async () => {
    const f = await createMarriedFixture({ withCharitableTrust: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.charitableTrustId, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // Entity re-homed (same id) on S.
      const [crt] = await db.select().from(entities).where(eq(entities.id, f.charitableTrustId));
      expect(crt.clientId).toBe(result.spouseClientId);

      // Split-interest details re-pointed: clientId S, measuring life → S child, charity → S copy.
      const [details] = await db
        .select()
        .from(trustSplitInterestDetails)
        .where(eq(trustSplitInterestDetails.entityId, f.charitableTrustId));
      expect(details.clientId).toBe(result.spouseClientId);
      const [sChild] = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, result.spouseClientId), eq(familyMembers.role, "child")));
      expect(details.measuringLife1Id).toBe(sChild.id);
      const sCharities = await db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, result.spouseClientId));
      expect(sCharities).toHaveLength(1);
      expect(details.charityId).toBe(sCharities[0].id);

      // The trust's own remainder designation re-pointed to S + the same S charity.
      const desigs = await db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.entityId, f.charitableTrustId));
      expect(desigs).toHaveLength(1);
      expect(desigs[0].clientId).toBe(result.spouseClientId);
      expect(desigs[0].externalBeneficiaryId).toBe(sCharities[0].id);
    } finally {
      await teardownCommit(f, result);
    }
  });

  // ── Task 12: original cleanup, CRM edge, bookkeeping, conservation, atomicity ──

  it("cleans up P: nulls spouse planning fields + single filing, deletes spouse fm + its CRM contact, flips joint owner enums, writes the ex_spouse edge, invalidates P caches", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    const year = new Date().getFullYear();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // A joint income (in the pool → needsDecision) and a joint deduction (not
      // in the pool) on P exercise the owner-enum flips 'joint'→'client'. NOTE:
      // medicare_coverage is never 'joint' in live data (its dbMapper rejects it,
      // so the snapshot's tree-load would crash) — the flip still runs defensively
      // but can't be seeded here.
      const [jointIncome] = await db
        .insert(incomes)
        .values({
          clientId: f.clientId,
          scenarioId: f.baseScenarioId,
          type: "salary",
          name: "Joint Consulting",
          annualAmount: "20000.00",
          startYear: year,
          endYear: year + 10,
          owner: "joint",
        })
        .returning({ id: incomes.id });
      await db.insert(clientDeductions).values({
        clientId: f.clientId,
        scenarioId: f.baseScenarioId,
        type: "charitable",
        owner: "joint",
        annualAmount: "5000.00",
        startYear: year,
        endYear: year + 10,
      });

      // Seed a Monte-Carlo + solver cache row for P so the invalidation is observable.
      await db.insert(scenarioComputeCache).values({
        firmId: f.firmId,
        clientId: f.clientId,
        scenarioId: f.baseScenarioId,
        kind: "monte_carlo",
        inputHash: "t12-cleanup-test",
        trials: 1000,
        engineVersion: 1,
        payload: {},
      });
      await db.insert(solverMcCache).values({
        firmId: f.firmId,
        clientId: f.clientId,
        inputHash: "t12-cleanup-test",
        successRate: 0.9,
      });

      // Keep everything on P; the joint income also needs an explicit decision.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "income", targetId: jointIncome.id, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      const [plan] = await db.select().from(divorcePlans).where(eq(divorcePlans.clientId, f.clientId));

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // ── P clients row: spouse planning fields nulled, filing = primaryFilingStatus ──
      const [pClient] = await db.select().from(clients).where(eq(clients.id, f.clientId));
      expect(pClient.spouseRetirementAge).toBeNull();
      expect(pClient.spouseRetirementMonth).toBeNull();
      expect(pClient.spouseLifeExpectancy).toBeNull();
      expect(pClient.filingStatus).toBe(plan.primaryFilingStatus); // default "single"

      // ── Spouse's P family member gone; its CRM contact gone ──
      const spouseFm = await db.select().from(familyMembers).where(eq(familyMembers.id, f.spouseFmId));
      expect(spouseFm).toHaveLength(0);
      const spouseContact = await db
        .select()
        .from(crmHouseholdContacts)
        .where(and(eq(crmHouseholdContacts.householdId, f.householdId), eq(crmHouseholdContacts.role, "spouse")));
      expect(spouseContact).toHaveLength(0);

      // ── Owner-enum flips on P: joint → client ──
      const [inc] = await db.select().from(incomes).where(eq(incomes.id, jointIncome.id));
      expect(inc.clientId).toBe(f.clientId);
      expect(inc.owner).toBe("client");
      const [ded] = await db.select().from(clientDeductions).where(eq(clientDeductions.clientId, f.clientId));
      expect(ded.owner).toBe("client");

      // ── CRM ex_spouse edge: from S household → to P household ──
      const edges = await db
        .select()
        .from(crmHouseholdRelationships)
        .where(eq(crmHouseholdRelationships.toHouseholdId, f.householdId));
      expect(edges).toHaveLength(1);
      expect(edges[0].fromHouseholdId).toBe(result.spouseHouseholdId);
      expect(edges[0].relationshipType).toBe("ex_spouse");

      // ── Both P caches invalidated ──
      const cc = await db.select().from(scenarioComputeCache).where(eq(scenarioComputeCache.clientId, f.clientId));
      expect(cc).toHaveLength(0);
      const sc = await db.select().from(solverMcCache).where(eq(solverMcCache.clientId, f.clientId));
      expect(sc).toHaveLength(0);

      // Plan finalized.
      const [committed] = await db.select().from(divorcePlans).where(eq(divorcePlans.clientId, f.clientId));
      expect(committed.status).toBe("committed");
      expect(committed.resultClientId).toBe(result.spouseClientId);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("conserves net worth to the cent across P∪S (moves + split) and collapses a retained joint account's owners (owed b)", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "split", splitPercentToSpouse: 60 },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      // Pre-commit household total (spouse401k / spouseSalary auto-move; the split
      // and the mortgage move all conserve value).
      const preTotal = await netCents(f.clientId);

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // ── Conservation anchor: P∪S post === P pre, to the cent ──
      const postP = await netCents(f.clientId);
      const postS = await netCents(result.spouseClientId);
      expect(postP + postS).toBe(preTotal);

      // ── Owed (b): the retained joint house had its spouse owner dropped BEFORE
      // the spouse fm delete, re-normalized to the primary at 100% — otherwise
      // the deferred owner-sum check would have rolled the whole commit back. ──
      const houseOwners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, f.ids.house));
      expect(houseOwners).toHaveLength(1);
      expect(houseOwners[0].familyMemberId).toBe(f.primaryFmId);
      expect(houseOwners[0].percent).toBe("1.0000");
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("executes cleanup selections: a checked (default) spouse-naming designation is removed; an unchecked (remove:false) one survives", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // Two designations on P-retained accounts that NAME the spouse via
      // householdRole (no family_member FK → not cascaded by the spouse fm
      // delete, so remove:false genuinely survives).
      const [desChecked] = await db
        .insert(beneficiaryDesignations)
        .values({
          clientId: f.clientId,
          targetKind: "account",
          accountId: f.ids.primaryBrokerage,
          tier: "primary",
          householdRole: "spouse",
          percentage: "100.00",
          sortOrder: 0,
        })
        .returning({ id: beneficiaryDesignations.id });
      const [desUnchecked] = await db
        .insert(beneficiaryDesignations)
        .values({
          clientId: f.clientId,
          targetKind: "account",
          accountId: f.ids.house,
          tier: "primary",
          householdRole: "spouse",
          percentage: "100.00",
          sortOrder: 0,
        })
        .returning({ id: beneficiaryDesignations.id });

      // Persist the advisor's "keep this one" decision for the second designation.
      await db
        .update(divorcePlans)
        .set({ beneficiaryCleanup: { selections: [{ source: "beneficiary_designation", id: desUnchecked.id, remove: false }] } })
        .where(eq(divorcePlans.clientId, f.clientId));

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

      const checked = await db.select().from(beneficiaryDesignations).where(eq(beneficiaryDesignations.id, desChecked.id));
      expect(checked).toHaveLength(0); // removed (default remove:true)
      const unchecked = await db.select().from(beneficiaryDesignations).where(eq(beneficiaryDesignations.id, desUnchecked.id));
      expect(unchecked).toHaveLength(1); // survives (persisted remove:false)
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("is atomic: a late failure persists NOTHING — no S client, P untouched, plan still draft, snapshot compensated", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await confirmJointItems(f);

      // Force a late (finalize-phase) failure inside the transaction.
      const spy = vi
        .spyOn(activityModule, "recordActivityNonFatal")
        .mockRejectedValue(new Error("injected late failure"));
      let caught: unknown;
      try {
        await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      } catch (err) {
        caught = err;
      } finally {
        spy.mockRestore();
      }
      expect(caught).toBeInstanceOf(Error);

      // Plan still a draft; nothing produced.
      const [plan] = await db.select().from(divorcePlans).where(eq(divorcePlans.clientId, f.clientId));
      expect(plan.status).toBe("draft");
      expect(plan.resultClientId).toBeNull();

      // P untouched: filing status, spouse fm, and the joint account's owners all intact.
      const [pClient] = await db.select().from(clients).where(eq(clients.id, f.clientId));
      expect(pClient.filingStatus).toBe("married_joint");
      const spouseFm = await db.select().from(familyMembers).where(eq(familyMembers.id, f.spouseFmId));
      expect(spouseFm).toHaveLength(1);
      const owners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, f.ids.jointBrokerage));
      expect(owners).toHaveLength(2);

      // Pre-tx side effects compensated: no snapshot survived for P.
      const snaps = await db.select().from(scenarioSnapshots).where(eq(scenarioSnapshots.clientId, f.clientId));
      expect(snaps).toHaveLength(0);

      // No S client linked, no ex_spouse edge from/to P's household.
      const edges = await db
        .select()
        .from(crmHouseholdRelationships)
        .where(eq(crmHouseholdRelationships.toHouseholdId, f.householdId));
      expect(edges).toHaveLength(0);
    } finally {
      await destroyFixture(f);
    }
  });

  it("re-defaults P's household checking when the default account moved to the spouse (owed a)", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // Two household cash accounts on P (no owners — mirrors the seeded default's
      // shape). defaultCash is the flagged default and is awarded to the spouse;
      // otherCash stays and should be promoted to the new default.
      const [defaultCash] = await db
        .insert(accounts)
        .values({
          clientId: f.clientId,
          scenarioId: f.baseScenarioId,
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: "10000.00",
          basis: "10000.00",
          isDefaultChecking: true,
        })
        .returning({ id: accounts.id });
      const [otherCash] = await db
        .insert(accounts)
        .values({
          clientId: f.clientId,
          scenarioId: f.baseScenarioId,
          name: "Backup Checking",
          category: "cash",
          subType: "checking",
          value: "5000.00",
          basis: "5000.00",
          isDefaultChecking: false,
        })
        .returning({ id: accounts.id });

      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: defaultCash.id, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: otherCash.id, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // P now has exactly one default-checking account: the promoted otherCash.
      const pDefaults = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, f.clientId), eq(accounts.isDefaultChecking, true)));
      expect(pDefaults).toHaveLength(1);
      expect(pDefaults[0].id).toBe(otherCash.id);

      // The moved default landed on S with the flag cleared; S keeps exactly one
      // default (its own seeded Household Cash).
      const [moved] = await db.select().from(accounts).where(eq(accounts.id, defaultCash.id));
      expect(moved.clientId).toBe(result.spouseClientId);
      expect(moved.isDefaultChecking).toBe(false);
      const sDefaults = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, result.spouseClientId), eq(accounts.isDefaultChecking, true)));
      expect(sDefaults).toHaveLength(1);
      expect(sDefaults[0].id).not.toBe(defaultCash.id);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("flips the P-retained copy of a duplicate-allocated spouse-grantor entity off the departed spouse (owed c)", async () => {
    const f = await createMarriedFixture();
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // A no-owner entity (→ side 'joint' → default 'duplicate') whose grantor is
      // the spouse. Its P copy must lose the departed spouse; its S copy takes
      // grantor 'client'.
      const [ent] = await db
        .insert(entities)
        .values({
          clientId: f.clientId,
          name: "Spouse Grantor Trust",
          entityType: "trust",
          trustSubType: "irrevocable",
          isIrrevocable: true,
          isGrantor: true,
          grantor: "spouse",
          value: "0.00",
          basis: "0.00",
        })
        .returning({ id: entities.id });

      await confirmJointItems(f);

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // P copy (original id): spouse grantor flipped off, isGrantor recomputed false.
      const [pEnt] = await db.select().from(entities).where(eq(entities.id, ent.id));
      expect(pEnt.clientId).toBe(f.clientId);
      expect(pEnt.grantor).toBeNull();
      expect(pEnt.isGrantor).toBe(false);

      // S copy: grantor 'client' (that side's person), isGrantor preserved.
      const sEnts = await db
        .select()
        .from(entities)
        .where(and(eq(entities.clientId, result.spouseClientId), eq(entities.name, "Spouse Grantor Trust")));
      expect(sEnts).toHaveLength(1);
      expect(sEnts[0].grantor).toBe("client");
      expect(sEnts[0].isGrantor).toBe(true);
    } finally {
      await teardownCommit(f, result);
    }
  });

  // ── Final-review round: designation safety + container follow-through ──

  it("duplicating a trust keeps the primary-named designation on P and copies only the spouse-named one to S (C1)", async () => {
    const f = await createMarriedFixture({ withTrustPrincipalDesignations: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "entity", targetId: f.ids.trust, disposition: "duplicate", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      // Default selection (no beneficiaryCleanup override).
      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // The primary-named designation SURVIVES on P's retained trust copy — it
      // was never a P-side strike (C1: the old code emitted a spouse-side row
      // whose id was this P row, deleting it in the default path).
      const [pDes] = await db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.id, f.trustPrimaryDesignationId));
      expect(pDes).toBeDefined();
      expect(pDes.clientId).toBe(f.clientId);
      expect(pDes.entityId).toBe(f.ids.trust);

      // The P-side spouse-named row is struck (it names the departing ex).
      const pSpouse = await db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.id, f.trustSpouseDesignationId));
      expect(pSpouse).toHaveLength(0);

      // S's duplicated trust carries exactly ONE designation — the spouse-named
      // one, re-pointed to S's client. The primary-named one never reached S.
      const [sTrust] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.clientId, result.spouseClientId), eq(entities.name, "Family Irrevocable Trust")));
      const sDes = await db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.entityId, sTrust.id));
      expect(sDes).toHaveLength(1);
      const sFm = await sClientFmId(result.spouseClientId);
      expect(sDes[0].familyMemberId).toBe(sFm);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("awarding a rental property to the spouse re-homes its linkedPropertyId income onto S (C2)", async () => {
    const f = await createMarriedFixture({ withContainerLinkedIncomes: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.rentalAccountId, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      // The rental account moved to S…
      const [rental] = await db.select().from(accounts).where(eq(accounts.id, f.rentalAccountId));
      expect(rental.clientId).toBe(result.spouseClientId);
      expect(rental.scenarioId).toBe(result.spouseScenarioId);
      // …and its linkedPropertyId income followed onto S's base scenario (C2 —
      // previously it stranded on P referencing an S-side account).
      const [inc] = await db.select().from(incomes).where(eq(incomes.id, f.rentalIncomeId));
      expect(inc.clientId).toBe(result.spouseClientId);
      expect(inc.scenarioId).toBe(result.spouseScenarioId);
      expect(inc.linkedPropertyId).toBe(f.rentalAccountId);
    } finally {
      await teardownCommit(f, result);
    }
  });

  it("awarding a business account to the spouse re-homes its ownerAccountId income onto S (C2)", async () => {
    const f = await createMarriedFixture({ withContainerLinkedIncomes: true });
    let result: CommitResult | undefined;
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: USER });
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.businessAccountId, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      result = await commitDivorcePlan({ clientId: f.clientId, firmId: f.firmId, userId: USER });

      const [biz] = await db.select().from(accounts).where(eq(accounts.id, f.businessAccountId));
      expect(biz.clientId).toBe(result.spouseClientId);
      expect(biz.scenarioId).toBe(result.spouseScenarioId);
      const [inc] = await db.select().from(incomes).where(eq(incomes.id, f.businessIncomeId));
      expect(inc.clientId).toBe(result.spouseClientId);
      expect(inc.scenarioId).toBe(result.spouseScenarioId);
      expect(inc.ownerAccountId).toBe(f.businessAccountId);
      expect(inc.owner).toBe("client");
    } finally {
      await teardownCommit(f, result);
    }
  });
});
