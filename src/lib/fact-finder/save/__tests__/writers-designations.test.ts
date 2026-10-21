// src/lib/fact-finder/save/__tests__/writers-designations.test.ts
//
// Live dev database: the beneficiary designation writers (Plan 4, Task 8) — an
// account's, a life policy's and a trust's set, each written through its
// Details core on the save's transaction. The core replaces a record's whole
// set, so the writer keeps every tier on record the line doesn't name: a new
// retirement account's default beneficiaries, a trust's other tiers, a
// remainder row's distribution form. Everything lives under a firm id no
// other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_designations", orgRole: "org:admin" }),
}));

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountOwners, accounts, auditLog, beneficiaryDesignations, entities, externalBeneficiaries, familyMembers } from "@/db/schema";
import { defaultRetirementBeneficiaries } from "@/lib/beneficiaries/default-retirement-beneficiaries";
import { createAccountForClient } from "@/lib/clients/accounts-writes";
import { replaceAccountBeneficiariesForClient, replaceTrustBeneficiariesForClient } from "@/lib/clients/beneficiary-designations-writes";
import type { DbOrTx, Tx } from "@/lib/db-tx";
import type { ChangeLine, PlacedValue, RecordRef, TargetKind } from "@/lib/fact-finder/change-set";
import { diffDrafts } from "@/lib/fact-finder/placement/diff";
import { DraftBuilder } from "@/lib/fact-finder/placement/map/helpers";
import { findRecord, type RecordBook } from "@/lib/fact-finder/placement/types";
import { loadRecordBook } from "@/lib/fact-finder/records/book";
import { unwrap } from "../types";
import { ACCOUNT_WRITERS } from "../writers/accounts";
import { DESIGNATION_WRITERS } from "../writers/designations";
import { SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_designations";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const { account_beneficiary_designation: accountSet, life_insurance_policy_beneficiary: policySet, trust_beneficiary_designation: trustSet } = DESIGNATION_WRITERS;

let seed: SaveSeed;
/** Mark and Laura's daughter, on the plan before every save here. */
let emma: string;
const at = () => ({ clientId: seed.clientId, firmId: FIRM });

const record = (target: TargetKind, id: string): RecordRef => ({ ref: "record", target, id });
const lineRef = (target: TargetKind, lineId: string): RecordRef => ({ ref: "line", target, lineId });
const LAURA: RecordRef = { ref: "person", role: "spouse" };
const named = (...rows: [tier: string, who: RecordRef, percentage: number][]): PlacedValue =>
  rows.map(([tier, who, percentage]) => ({ tier, who, percentage }));

/** Expected rows, in setOf's order. */
const sorted = (...rows: string[]) => rows.sort();

/** A set as stored — "tier who percentage [form]", who being the household role or the record's id — sorted. */
async function setOf(parent: { accountId: string } | { entityId: string }, handle: DbOrTx = db): Promise<string[]> {
  const rows = await handle
    .select()
    .from(beneficiaryDesignations)
    .where("accountId" in parent ? eq(beneficiaryDesignations.accountId, parent.accountId) : eq(beneficiaryDesignations.entityId, parent.entityId));
  return rows
    .map((r) => [r.tier, r.householdRole ?? r.familyMemberId ?? r.externalBeneficiaryId ?? r.entityIdRef ?? (r.otherHeirs ? "other_heirs" : null), r.percentage, r.distributionForm].filter(Boolean).join(" "))
    .sort();
}

/**
 * A retirement account owned by Mark as createAccountForClient writes one: the
 * account, its owner row and the household's default beneficiaries (Laura
 * primary, the children contingent). Inserted directly on the transaction —
 * the accounts core joins a transaction in Task 2, not here.
 */
async function newIra(tx: Tx, name: string): Promise<string> {
  const { clientId, scenarioId, clientMemberId } = seed;
  const [ira] = await tx.insert(accounts).values({ clientId, scenarioId, name, category: "retirement", subType: "traditional_ira" }).returning({ id: accounts.id });
  await tx.insert(accountOwners).values({ accountId: ira.id, familyMemberId: clientMemberId, percent: "1" });
  const people = await tx
    .select({ id: familyMembers.id, role: familyMembers.role, relationship: familyMembers.relationship })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId))
    .orderBy(asc(familyMembers.dateOfBirth), asc(familyMembers.firstName));
  const defaults = defaultRetirementBeneficiaries(clientMemberId, people);
  await tx.insert(beneficiaryDesignations).values(
    defaults.map((x) => ({ clientId, targetKind: "account" as const, accountId: ira.id, tier: x.tier, percentage: x.percentage.toFixed(2), householdRole: x.householdRole, familyMemberId: x.familyMemberId, sortOrder: x.sortOrder })),
  );
  return ira.id;
}

/** The records a save makes before its designation lines (D8): a child, a charity, two trusts, a life policy — on the transaction. */
async function newRecords(tx: Tx) {
  const { clientId, scenarioId } = seed;
  const [noah] = await tx.insert(familyMembers).values({ clientId, firstName: "Noah", lastName: "Hendricks", relationship: "child", dateOfBirth: "2004-02-10" }).returning();
  const [redCross] = await tx.insert(externalBeneficiaries).values({ clientId, name: "American Red Cross" }).returning();
  const [trust] = await tx.insert(entities).values({ clientId, name: "Hendricks Family Trust", entityType: "trust" }).returning();
  const [dynasty] = await tx.insert(entities).values({ clientId, name: "Hendricks Dynasty Trust", entityType: "trust" }).returning();
  const [policy] = await tx.insert(accounts).values({ clientId, scenarioId, name: "Term Life", category: "life_insurance", subType: "term" }).returning();
  return { noah: noah.id, redCross: redCross.id, trust: trust.id, dynasty: dynasty.id, policy: policy.id };
}

/** Committed records with sets on record: an IRA (Laura primary, Emma contingent), a life policy (Laura primary), a trust (Laura income, Emma remainder in trust). */
async function recordsOnPlan() {
  const { clientId, scenarioId } = seed;
  const [ira] = await db.insert(accounts).values({ clientId, scenarioId, name: "Mark's Rollover IRA", category: "retirement", subType: "traditional_ira" }).returning();
  const [policy] = await db.insert(accounts).values({ clientId, scenarioId, name: "Whole Life", category: "life_insurance", subType: "whole_life" }).returning();
  const [trust] = await db.insert(entities).values({ clientId, name: "Hendricks Legacy Trust", entityType: "trust" }).returning();
  const row = (r: Partial<typeof beneficiaryDesignations.$inferInsert> & Pick<typeof beneficiaryDesignations.$inferInsert, "tier" | "targetKind">) => ({ clientId, percentage: "100.00", ...r });
  await db.insert(beneficiaryDesignations).values([
    row({ targetKind: "account", accountId: ira.id, tier: "primary", householdRole: "spouse" }),
    row({ targetKind: "account", accountId: ira.id, tier: "contingent", familyMemberId: emma }),
    row({ targetKind: "account", accountId: policy.id, tier: "primary", householdRole: "spouse" }),
    row({ targetKind: "trust", entityId: trust.id, tier: "income", householdRole: "spouse" }),
    row({ targetKind: "trust", entityId: trust.id, tier: "remainder", familyMemberId: emma, distributionForm: "in_trust" }),
  ]);
  return { ira: ira.id, policy: policy.id, trust: trust.id };
}

const auditRows = () => db.select().from(auditLog).where(eq(auditLog.clientId, seed.clientId));
const designationCount = async () => (await db.select().from(beneficiaryDesignations).where(eq(beneficiaryDesignations.clientId, seed.clientId))).length;

d("DESIGNATION_WRITERS", () => {
  beforeAll(async () => {
    await dropSaveFirm(FIRM);
    seed = await seedSaveClient(FIRM, { coClient: true });
    [{ id: emma }] = await db
      .insert(familyMembers)
      .values({ clientId: seed.clientId, firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2001-05-01" })
      .returning({ id: familyMembers.id });
  });
  afterAll(() => dropSaveFirm(FIRM));

  it("(a)(c) Creates on records made earlier in the save: each set names them, a new IRA keeps the default tier the line leaves blank; it commits, writing no audit row", async () => {
    const { result, queued } = await inSave(at(), async (ctx) => {
      const iraA = await newIra(ctx.tx, "Mark's IRA");
      const iraB = await newIra(ctx.tx, "Mark's SEP IRA");
      const made = await newRecords(ctx.tx);
      const ids = {
        "line:ira-a": iraA, "line:ira-b": iraB, "line:policy": made.policy, "line:trust": made.trust,
        "line:dynasty": made.dynasty, "line:noah": made.noah, "line:red-cross": made.redCross,
      };
      const noah = lineRef("family_member", "noah");
      const redCross = lineRef("external_beneficiary", "red-cross");
      // A line names only the tiers the fact finder filled: IRA A its contingent, IRA B its primary.
      const contingentOnly = changeLine("account_beneficiary_designation", { beneficiaries: named(["contingent", noah, 50], ["contingent", redCross, 50]) }, { parent: lineRef("account", "ira-a") });
      const primaryOnly = changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", noah, 100]) }, { parent: lineRef("account", "ira-b") });
      const policyLine = changeLine("life_insurance_policy_beneficiary", { beneficiaries: named(["primary", LAURA, 100], ["contingent", lineRef("entity", "trust"), 100]) }, { parent: lineRef("life_insurance_policy", "policy") });
      const trustLine = changeLine("trust_beneficiary_designation", { beneficiaries: named(["income", LAURA, 100], ["remainder", noah, 50], ["remainder", redCross, 25], ["remainder", lineRef("entity", "dynasty"), 25]) }, { parent: lineRef("entity", "trust") });
      return {
        ...made, iraA, iraB,
        returned: [
          await accountSet.create(ctx, inputOf(contingentOnly, ids)),
          await accountSet.create(ctx, inputOf(primaryOnly, ids)),
          await policySet.create(ctx, inputOf(policyLine, ids)),
          await trustSet.create(ctx, inputOf(trustLine, ids)),
        ],
      };
    });
    const { iraA, iraB, policy, trust, dynasty, noah, redCross } = result;
    expect(result.returned).toEqual([iraA, iraB, policy, trust]);
    expect(await setOf({ accountId: iraA })).toEqual(sorted(`contingent ${noah} 50.00`, `contingent ${redCross} 50.00`, "primary spouse 100.00"));
    expect(await setOf({ accountId: iraB })).toEqual(sorted(`contingent ${emma} 100.00`, `primary ${noah} 100.00`));
    expect(await setOf({ accountId: policy })).toEqual(sorted(`contingent ${trust} 100.00`, "primary spouse 100.00"));
    // A remainder row the trust had no form for gets the route's default.
    expect(await setOf({ entityId: trust })).toEqual(sorted("income spouse 100.00", `remainder ${noah} 50.00 outright`, `remainder ${redCross} 25.00 outright`, `remainder ${dynasty} 25.00 outright`));
    expect(await auditRows()).toEqual([]);
    expect(queued).toBe(0);
  });

  it("(a)(d) Updates commit: a tier the line doesn't name stays as on record, and a remainder row keeps its distribution form", async () => {
    const plan = await recordsOnPlan();
    const emmaRef = record("family_member", emma);
    await inSave(at(), async (ctx) => {
      const iraLine = changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", emmaRef, 100]) }, { recordId: plan.ira });
      const policyLine = changeLine("life_insurance_policy_beneficiary", { beneficiaries: named(["contingent", emmaRef, 100]) }, { recordId: plan.policy });
      // As Plan 3's estate map makes it: the income tier filled, the blank remainder tier's rows on record carried in (no form).
      const trustLine = changeLine("trust_beneficiary_designation", { beneficiaries: named(["income", emmaRef, 100], ["remainder", emmaRef, 100]) }, { recordId: plan.trust });
      await accountSet.update(ctx, inputOf(iraLine));
      await policySet.update(ctx, inputOf(policyLine));
      await trustSet.update(ctx, inputOf(trustLine));
    });
    expect(await setOf({ accountId: plan.ira })).toEqual(sorted(`contingent ${emma} 100.00`, `primary ${emma} 100.00`));
    expect(await setOf({ accountId: plan.policy })).toEqual(sorted(`contingent ${emma} 100.00`, "primary spouse 100.00"));
    expect(await setOf({ entityId: plan.trust })).toEqual(sorted(`income ${emma} 100.00`, `remainder ${emma} 100.00 in_trust`));
    expect(await auditRows()).toEqual([]);
  });

  it("(b) a save that throws after the writes leaves no designation and no audit row, and the sets on record as they were", async () => {
    const plan = await recordsOnPlan();
    const before = { ira: await setOf({ accountId: plan.ira }), trust: await setOf({ entityId: plan.trust }) };
    const count = await designationCount();
    const { result } = await inSave(
      at(),
      async (ctx) => {
        const iraA = await newIra(ctx.tx, "Mark's IRA");
        const made = await newRecords(ctx.tx);
        const ids = { "line:ira-a": iraA, "line:noah": made.noah, "line:trust": made.trust };
        const noah = lineRef("family_member", "noah");
        await accountSet.create(ctx, inputOf(changeLine("account_beneficiary_designation", { beneficiaries: named(["contingent", noah, 100]) }, { parent: lineRef("account", "ira-a") }), ids));
        await trustSet.create(ctx, inputOf(changeLine("trust_beneficiary_designation", { beneficiaries: named(["remainder", noah, 100]) }, { parent: lineRef("entity", "trust") }), ids));
        await accountSet.update(ctx, inputOf(changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", noah, 100]) }, { recordId: plan.ira }), ids));
        await trustSet.update(ctx, inputOf(changeLine("trust_beneficiary_designation", { beneficiaries: named(["income", noah, 100]) }, { recordId: plan.trust }), ids));
        // Inside the transaction every write landed.
        return { ira: await setOf({ accountId: plan.ira }, ctx.tx), noah: made.noah };
      },
      { rollback: true },
    );
    expect(result.ira).toEqual(sorted(`contingent ${emma} 100.00`, `primary ${result.noah} 100.00`));
    expect(await setOf({ accountId: plan.ira })).toEqual(before.ira);
    expect(await setOf({ entityId: plan.trust })).toEqual(before.trust);
    expect(await designationCount()).toBe(count);
    expect(await auditRows()).toEqual([]);
  });

  it("a line whose set the core refuses throws its reason — a trust's set on a record that isn't a trust, a beneficiary of another client", async () => {
    const plan = await recordsOnPlan();
    const [business] = await db.insert(entities).values({ clientId: seed.clientId, name: "Hendricks LLC", entityType: "llc" }).returning();
    const other = await seedSaveClient(FIRM);
    await expect(
      inSave(at(), (ctx) => trustSet.update(ctx, inputOf(changeLine("trust_beneficiary_designation", { beneficiaries: named(["income", LAURA, 100]) }, { recordId: business.id })))),
    ).rejects.toThrow("Entity is not a trust");
    await expect(
      inSave(at(), (ctx) =>
        accountSet.update(ctx, inputOf(changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", record("family_member", other.clientMemberId), 100]) }, { recordId: plan.ira }))),
      ),
    ).rejects.toThrow("One or more family members not found for this client");
  });

  it("called without a transaction, each core replaces the set in a transaction of its own and answers as its route did", async () => {
    const plan = await recordsOnPlan();
    const account = await replaceAccountBeneficiariesForClient({
      clientId: seed.clientId, firmId: FIRM, accountId: plan.ira,
      input: [{ tier: "primary", percentage: 100, familyMemberId: emma }, { tier: "remainder", percentage: 100, householdRole: "spouse" }],
    });
    // The account set stores no distribution form, and a row's sort order is the one sent (the schema's 0).
    expect(account.ok && account.data.map((r) => [r.tier, r.sortOrder, r.distributionForm])).toEqual([["primary", 0, null], ["remainder", 0, null]]);
    expect(await setOf({ accountId: plan.ira })).toEqual(sorted(`primary ${emma} 100.00`, "remainder spouse 100.00"));
    const trust = await replaceTrustBeneficiariesForClient({ clientId: seed.clientId, firmId: FIRM, entityId: plan.trust, input: [] });
    expect(trust).toEqual({ ok: true, data: [], resourceId: plan.trust });
    expect(await setOf({ entityId: plan.trust })).toEqual([]);
    expect(await replaceAccountBeneficiariesForClient({ clientId: seed.clientId, firmId: FIRM, accountId: plan.trust, input: [] })).toEqual({ ok: false, status: 404, error: "Not found" });
    const invalid = await replaceTrustBeneficiariesForClient({ clientId: seed.clientId, firmId: FIRM, entityId: plan.trust, input: [{ tier: "income", percentage: 60, householdRole: "spouse" }] });
    expect(invalid).toMatchObject({ ok: false, status: 400, error: "Invalid body", body: { error: "Invalid body", issues: [{ message: "income percentages must sum to 100 (got 60.00)." }] } });
  });

  it("a set refers to no other client's rows: the parent is looked up under this client", async () => {
    const other = await seedSaveClient(FIRM);
    const [foreign] = await db.insert(accounts).values({ clientId: other.clientId, scenarioId: other.scenarioId, name: "Not Mark's", category: "taxable", subType: "brokerage" }).returning();
    await expect(
      inSave(at(), (ctx) => accountSet.update(ctx, inputOf(changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", LAURA, 100]) }, { recordId: foreign.id })))),
    ).rejects.toThrow("Not found");
    expect(await setOf({ accountId: foreign.id })).toEqual([]);
  });

  describe("Other Heirs on record", () => {
    /** An IRA on the plan with the given rows, each naming Laura or Other Heirs. */
    async function iraWith(rows: { tier: "primary" | "contingent"; otherHeirs?: boolean }[]) {
      const { clientId, scenarioId } = seed;
      const [ira] = await db.insert(accounts).values({ clientId, scenarioId, name: "Mark's Legacy IRA", category: "retirement", subType: "traditional_ira" }).returning();
      await db.insert(beneficiaryDesignations).values(
        rows.map((r) => ({
          clientId, targetKind: "account" as const, accountId: ira.id, tier: r.tier, percentage: "100.00",
          ...(r.otherHeirs ? { otherHeirs: true } : { householdRole: "spouse" as const }),
        })),
      );
      return ira.id;
    }

    it("keeps an Other Heirs row in a tier it does not touch", async () => {
      const ira = await iraWith([{ tier: "primary" }, { tier: "contingent", otherHeirs: true }]);
      await inSave(at(), (ctx) =>
        accountSet.update(ctx, inputOf(changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", record("family_member", emma), 100]) }, { recordId: ira }))),
      );
      expect(await setOf({ accountId: ira })).toEqual(sorted("contingent other_heirs 100.00", `primary ${emma} 100.00`));
    });

    it("refuses to replace a tier that holds Other Heirs", async () => {
      const ira = await iraWith([{ tier: "primary", otherHeirs: true }]);
      await expect(
        inSave(at(), (ctx) =>
          accountSet.update(ctx, inputOf(changeLine("account_beneficiary_designation", { beneficiaries: named(["primary", record("family_member", emma), 100]) }, { recordId: ira }))),
        ),
      ).rejects.toThrow("These beneficiaries include Other Heirs, which can only be changed in the app.");
      expect(await setOf({ accountId: ira })).toEqual(["primary other_heirs 100.00"]);
    });
  });

  describe("an Update line built against the record book, as the review builds it", () => {
    const SECTION = { account_beneficiary_designation: "retirement", trust_beneficiary_designation: "trusts" } as const;

    /** One tier's rows of a set as the book holds it. */
    const tierOf = (set: PlacedValue | undefined, tier: string): PlacedValue[] =>
      Array.isArray(set) ? set.filter((e) => (e as { tier?: PlacedValue }).tier === tier) : [];

    /**
     * The set line on record `recordId` as Plan 3's beneficiariesOf builds it:
     * `filled` (tier → its rows) for the tiers the fact finder filled, and every
     * other tier's rows carried from the book; diffed against the book, so the
     * field's `onRecord` is the review's snapshot.
     */
    function setLine(book: RecordBook, target: keyof typeof SECTION, recordId: string, tiers: readonly string[], filled: Record<string, PlacedValue[]>): ChangeLine {
      const reviewed = findRecord(book, target, recordId)!.values.beneficiaries;
      const next = tiers.flatMap((tier) => filled[tier] ?? tierOf(reviewed, tier));
      const draft = new DraftBuilder({ sectionId: SECTION[target], row: { id: `row-${recordId}`, cells: {}, sourceFileIds: [] }, target, recordId, label: "Set — beneficiaries" })
        .put("beneficiaries", next, ["beneficiaries"])
        .build();
      return diffDrafts([draft], book)[0];
    }

    /** A household of Mark, Laura and Emma, and Mark's IRA made as the Details page makes one (its default beneficiaries: Laura primary, Emma contingent). */
    async function householdWithIra() {
      const s = await seedSaveClient(FIRM, { coClient: true });
      const [kid] = await db.insert(familyMembers).values({ clientId: s.clientId, firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2001-05-01" }).returning();
      const { resourceId: ira } = unwrap(
        await createAccountForClient({
          clientId: s.clientId, firmId: FIRM, actorId: SAVE_ACTOR,
          input: { name: "Mark's IRA", category: "retirement", subType: "traditional_ira", owners: [{ kind: "family_member", familyMemberId: s.clientMemberId, percent: 1 }] },
        }),
      );
      return { s, emma: kid.id, ira };
    }

    it("an owner change earlier in the save re-points the untouched defaults: a tier the line carries from the review keeps them, the tier the fact finder filled replaces", async () => {
      const { s, emma: kid, ira } = await householdWithIra();
      expect(await setOf({ accountId: ira })).toEqual(sorted(`contingent ${kid} 100.00`, "primary spouse 100.00"));
      const [redCross] = await db.insert(externalBeneficiaries).values({ clientId: s.clientId, name: "American Red Cross" }).returning();
      const book = await loadRecordBook(s.clientId, FIRM, s.scenarioId);
      // Primary left blank (Laura carried from the review), Contingent filled.
      const names = setLine(book, "account_beneficiary_designation", ira, ["primary", "contingent"], {
        contingent: [{ tier: "contingent", who: record("external_beneficiary", redCross.id), percentage: 100 }],
      });

      await inSave({ clientId: s.clientId, firmId: FIRM }, async (ctx) => {
        // The account line (D8: before every designation) hands the IRA to Laura; its core re-points the defaults at Mark.
        await ACCOUNT_WRITERS.account.update(ctx, inputOf(changeLine("account", { owners: [{ who: LAURA, percent: 1 }] }, { recordId: ira }), { "person:spouse": s.spouseMemberId! }));
        await accountSet.update(ctx, inputOf(names));
      });

      expect(await setOf({ accountId: ira })).toEqual(sorted(`contingent ${redCross.id} 100.00`, "primary client 100.00"));
    });

    it("a remainder row naming the co-client by family member keeps its distribution form — carried, or named again by role in a changed tier", async () => {
      const s = await seedSaveClient(FIRM, { coClient: true });
      const [kid] = await db.insert(familyMembers).values({ clientId: s.clientId, firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2001-05-01" }).returning();
      const trustOn = async (name: string) => {
        const [trust] = await db.insert(entities).values({ clientId: s.clientId, name, entityType: "trust" }).returning();
        await db.insert(beneficiaryDesignations).values({
          clientId: s.clientId, targetKind: "trust", entityId: trust.id, tier: "remainder", familyMemberId: s.spouseMemberId, percentage: "100.00", distributionForm: "in_trust",
        });
        return trust.id;
      };
      const carried = await trustOn("Hendricks Legacy Trust");
      const changed = await trustOn("Hendricks Dynasty Trust");
      const book = await loadRecordBook(s.clientId, FIRM, s.scenarioId);
      const emmaRef = record("family_member", kid.id);
      const tiers = ["income", "remainder"];

      await inSave({ clientId: s.clientId, firmId: FIRM }, async (ctx) => {
        await trustSet.update(ctx, inputOf(setLine(book, "trust_beneficiary_designation", carried, tiers, { income: [{ tier: "income", who: emmaRef, percentage: 100 }] })));
        await trustSet.update(
          ctx,
          inputOf(setLine(book, "trust_beneficiary_designation", changed, tiers, {
            remainder: [{ tier: "remainder", who: LAURA, percentage: 60 }, { tier: "remainder", who: emmaRef, percentage: 40 }],
          })),
        );
      });

      expect({ carried: await setOf({ entityId: carried }), changed: await setOf({ entityId: changed }) }).toEqual({
        carried: sorted(`income ${kid.id} 100.00`, `remainder ${s.spouseMemberId} 100.00 in_trust`),
        changed: sorted(`remainder ${kid.id} 40.00 outright`, "remainder spouse 60.00 in_trust"),
      });
    });
  });
});
