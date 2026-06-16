// src/lib/clients/__tests__/liabilities-writes.test.ts
//
// Core write tests for the liabilities write-core — mirrors incomes-writes.test.ts
// with liability-specific adjustments (owners[] satellite, parent-business check,
// parent-vs-owners mutual exclusion). Hits the real Neon dev branch and skips
// cleanly without a DB so it never adds to the no-delta failing set in CI.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { liabilities, liabilityOwners, entities, familyMembers } from "@/db/schema";
import {
  createLiabilityForClient,
  updateLiabilityForClient,
  deleteLiabilityForClient,
} from "../liabilities-writes";

// verifyClientAccess (via authz.ts → staffMaySeeAdvisor) calls Clerk's auth(),
// which throws under vitest. Mock it to a firm-wide admin: org:admin is not a
// STAFF_ROLE, so the staff-scope check short-circuits true and access reduces to
// the DB firm-membership check. recordCreate/Update/Delete get actorId explicitly
// from the core, so they never read auth() here.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_liability_core", orgRole: "org:admin" }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_liability_core";

// Cooper "client" family member — used for the owners[] happy path.
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
// Cooper "Consulting Business" account (category === "business") — a valid parent.
const COOPER_BUSINESS_ACCOUNT_ID = "f43af48f-178c-417f-8934-79dba967de93";
// Cooper "Home" account (real_estate, NOT business) — proves the non-business
// parentAccountId 400 path.
const COOPER_NONBUSINESS_ACCOUNT_ID = "573b1c44-067d-4112-aa90-762af7a0c55f";
// An account that belongs to a DIFFERENT client — used to prove cross-client FK
// isolation: attaching it as linkedPropertyId must be rejected 400, not written.
const FOREIGN_ACCOUNT_ID = "3d552610-0eff-47b4-a7bf-fe3a3805d876";

d("liabilities-writes core", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      // liabilityOwners cascades on liability delete (onDelete: "cascade"), so
      // deleting the liability is enough.
      await db.delete(liabilities).where(eq(liabilities.id, id));
    }
  });

  it("create happy path → {ok, data, resourceId === data.id} + sane defaults round-trip", async () => {
    const res = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Core test liability", startYear: 2026, termMonths: 360 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return; // narrow for TS
    createdIds.push(res.data.id);
    expect(res.resourceId).toBe(res.data.id);
    expect(res.data.name).toBe("Core test liability");
    expect(res.data.startYear).toBe(2026);
    expect(res.data.termMonths).toBe(360);
    // decimal(15,2) round-trips as a fixed-scale string; default "0" → "0.00".
    expect(res.data.balance).toBe("0.00");
    expect(res.data.monthlyPayment).toBe("0.00");
    // decimal(5,4) interestRate default "0" → "0.0000".
    expect(res.data.interestRate).toBe("0.0000");
    // Schema defaults.
    expect(res.data.startMonth).toBe(1);
    expect(res.data.termUnit).toBe("annual");
    expect(res.data.isInterestDeductible).toBe(false);
  });

  it("create with explicit owners[] → {ok:true} and a liabilityOwners row is written", async () => {
    const res = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Owned liability",
        startYear: 2026,
        termMonths: 120,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 }],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.data.id);

    const owners = await db
      .select()
      .from(liabilityOwners)
      .where(eq(liabilityOwners.liabilityId, res.data.id));
    expect(owners.length).toBe(1);
    expect(owners[0].familyMemberId).toBe(COOPER_FM_ID);
    expect(owners[0].entityId).toBeNull();
  });

  it("create with parentAccountId AND owners[] → {ok:false, status:400} (mutual exclusion)", async () => {
    // COOPER_BUSINESS_ACCOUNT_ID is a real category==="business" account, so the
    // parent-business check passes and the request reaches the parent-vs-owners
    // mutual-exclusion guard.
    const res = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Parent + owners",
        startYear: 2026,
        termMonths: 120,
        parentAccountId: COOPER_BUSINESS_ACCOUNT_ID,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 }],
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/both a parent business and explicit owners/i);
  });

  it("create with cross-client linkedPropertyId → {ok:false, status:400} + no row written", async () => {
    const res = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Foreign property",
        startYear: 2026,
        termMonths: 120,
        linkedPropertyId: FOREIGN_ACCOUNT_ID,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    // The row must NOT have been written.
    const rows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.linkedPropertyId, FOREIGN_ACCOUNT_ID));
    expect(rows.length).toBe(0);
  });

  it("create with a non-business parentAccountId → {ok:false, status:400} matching /business/i", async () => {
    const res = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Non-business parent",
        startYear: 2026,
        termMonths: 120,
        parentAccountId: COOPER_NONBUSINESS_ACCOUNT_ID,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/business/i);
  });

  it("delete happy path → create then delete returns {ok:true, data:{id}} and row is gone", async () => {
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Delete target", startYear: 2026, termMonths: 60 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const liabilityId = created.data.id;
    // Do NOT push to createdIds — delete will clean it up.

    const res = await deleteLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ id: liabilityId });

    const rows = await db
      .select({ id: liabilities.id })
      .from(liabilities)
      .where(eq(liabilities.id, liabilityId));
    expect(rows.length).toBe(0);
  });

  it("update happy path → {ok, data} with changed field, others untouched", async () => {
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Update target", startYear: 2026, termMonths: 240, monthlyPayment: 1500 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId: created.data.id,
      input: { monthlyPayment: 2000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resourceId).toBe(created.data.id);
    expect(res.data.monthlyPayment).toBe("2000.00");
    // Untouched fields preserved.
    expect(res.data.name).toBe("Update target");
    expect(res.data.startYear).toBe(2026);
    expect(res.data.termMonths).toBe(240);
  });

  it("update owners[] → delete+reinsert replaces the liabilityOwners rows", async () => {
    // Start owned by the Cooper client family member.
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Owners replace target",
        startYear: 2026,
        termMonths: 120,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 }],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    // Confirm the initial single owner row landed.
    const initial = await db
      .select()
      .from(liabilityOwners)
      .where(eq(liabilityOwners.liabilityId, created.data.id));
    expect(initial.length).toBe(1);
    expect(initial[0].familyMemberId).toBe(COOPER_FM_ID);

    // Discover a SECOND distinct owner for Cooper via the test's own `db` import —
    // guarantees we query the same branch the test writes to (branch-safe). Prefer a
    // Cooper spouse family member, then any Cooper entity.
    const [spouseFm] = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, COOPER_CLIENT_ID), eq(familyMembers.role, "spouse")))
      .limit(1);
    const [entity] = spouseFm
      ? []
      : await db
          .select({ id: entities.id })
          .from(entities)
          .where(eq(entities.clientId, COOPER_CLIENT_ID))
          .limit(1);

    let newOwnerInput: Record<string, unknown>;
    if (spouseFm) {
      newOwnerInput = { kind: "family_member", familyMemberId: spouseFm.id, percent: 1.0 };
    } else if (entity) {
      newOwnerInput = { kind: "entity", entityId: entity.id, percent: 1.0 };
    } else {
      // Fallback: no second distinct owner exists for Cooper. Update to the SAME
      // single owner — the delete+reinsert branch still runs end-to-end; we assert
      // exactly one row with that family member + percent remains.
      newOwnerInput = { kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 };
    }

    const res = await updateLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId: created.data.id,
      input: { owners: [newOwnerInput] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const after = await db
      .select()
      .from(liabilityOwners)
      .where(eq(liabilityOwners.liabilityId, created.data.id));
    // Exactly one row, percent round-trips as decimal(6,4).
    expect(after.length).toBe(1);
    expect(after[0].percent).toBe("1.0000");

    if (spouseFm) {
      expect(after[0].familyMemberId).toBe(spouseFm.id);
      expect(after[0].entityId).toBeNull();
      // Old owner row is gone — the COOPER_FM_ID identity was replaced.
      expect(after[0].familyMemberId).not.toBe(COOPER_FM_ID);
    } else if (entity) {
      expect(after[0].entityId).toBe(entity.id);
      expect(after[0].familyMemberId).toBeNull();
    } else {
      // Fallback assertion: same single owner, delete+reinsert still ran.
      expect(after[0].familyMemberId).toBe(COOPER_FM_ID);
      expect(after[0].entityId).toBeNull();
    }
  });

  it("update reparenting to a business parent → wipes liabilityOwners (real trigger enabled)", async () => {
    // Start owned by the Cooper client family member.
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Reparent wipe target",
        startYear: 2026,
        termMonths: 120,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 }],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    // Confirm the owner row landed before reparenting.
    const initial = await db
      .select()
      .from(liabilityOwners)
      .where(eq(liabilityOwners.liabilityId, created.data.id));
    expect(initial.length).toBe(1);

    // Reparent to a business account (no owners in the update body). Children of a
    // business inherit ownership via parentAccountId, so the reparent branch wipes
    // liabilityOwners atomically inside the core's transaction — leaving zero owner
    // rows.
    //
    // The DB carries a DEFERRABLE INITIALLY DEFERRED constraint trigger
    // (`liability_owners_sum_check`) that fires at COMMIT. Migration 0167 makes
    // check_liability_owners_sum SKIP the sum check when the liability's
    // parent_account_id is non-null (a child of a business legitimately has zero
    // owner rows), so this commit succeeds with the REAL trigger ENABLED. This test
    // therefore proves the live PUT route / Copilot tool reparent works end-to-end —
    // before 0167 it required disabling the trigger, which proved nothing about prod.
    const res = await updateLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId: created.data.id,
      input: { parentAccountId: COOPER_BUSINESS_ACCOUNT_ID },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.parentAccountId).toBe(COOPER_BUSINESS_ACCOUNT_ID);

    const after = await db
      .select()
      .from(liabilityOwners)
      .where(eq(liabilityOwners.liabilityId, created.data.id));
    expect(after.length).toBe(0);
  });

  // ── FK tenancy asserts on UPDATE (2026-06-16 hardening) ─────────────────────
  // The update path now runs the same conditional FK asserts as the CREATE core.
  // These lock the cross-client gap the original 1:1 port carried over from the
  // live PUT route (which ran no update-time asserts).

  it("update with cross-client linkedPropertyId → {ok:false, status:400} + not linked", async () => {
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "FK update target (linkedProperty)", startYear: 2026, termMonths: 120 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId: created.data.id,
      input: { linkedPropertyId: FOREIGN_ACCOUNT_ID },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);

    // The cross-client account must NOT have been linked.
    const [row] = await db
      .select({ linkedPropertyId: liabilities.linkedPropertyId })
      .from(liabilities)
      .where(eq(liabilities.id, created.data.id));
    expect(row.linkedPropertyId).toBeNull();
  });

  it("update with cross-client parentAccountId → {ok:false, status:400} + not reparented", async () => {
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "FK update target (parent)", startYear: 2026, termMonths: 120 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId: created.data.id,
      input: { parentAccountId: FOREIGN_ACCOUNT_ID },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);

    const [row] = await db
      .select({ parentAccountId: liabilities.parentAccountId })
      .from(liabilities)
      .where(eq(liabilities.id, created.data.id));
    expect(row.parentAccountId).toBeNull();
  });

  it("update with a non-business parentAccountId → {ok:false, status:400} matching /business/i", async () => {
    const created = await createLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "FK update target (non-business parent)", startYear: 2026, termMonths: 120 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateLiabilityForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      liabilityId: created.data.id,
      input: { parentAccountId: COOPER_NONBUSINESS_ACCOUNT_ID },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/business/i);
  });
});
