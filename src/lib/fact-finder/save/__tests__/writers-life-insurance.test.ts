// src/lib/fact-finder/save/__tests__/writers-life-insurance.test.ts
//
// Live dev database: the life insurance policy writer (Plan 4, Task 9). A
// policy line's request body goes through the policy routes' write core on the
// save's transaction — the account, its owners, the policy row and the audit
// row commit or roll back with it — and the writer adds the two columns the
// routes don't take: the carrier and the policy number's last 4. An owner can
// be a trust or a co-client written earlier in the same save. Everything lives
// under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_life", orgRole: "org:admin" }),
}));

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountOwners,
  accounts,
  auditLog,
  entities,
  familyMembers,
  lifeInsuranceCashValueSchedule,
  lifeInsurancePolicies,
} from "@/db/schema";
import { createInsurancePolicyForClient, updateInsurancePolicyForClient } from "@/lib/clients/insurance-policies-writes";
import type { ChangeLine, PlacedValue } from "../../change-set";
import { LIFE_WRITERS } from "../writers/life-insurance";
import { SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_life";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const writer = LIFE_WRITERS.life_insurance_policy;

const at = (seed: SaveSeed) => ({ clientId: seed.clientId, firmId: FIRM });
const people = (seed: SaveSeed) => ({ "person:client": seed.clientMemberId });

/** A whole life policy as the Life insurance section places one, owned by the client. */
function wholeLife(fields: Record<string, PlacedValue> = {}): ChangeLine {
  return changeLine("life_insurance_policy", {
    name: "Northwestern Whole Life",
    carrier: "Northwestern Mutual",
    policyNumberLast4: "9012",
    policyType: "whole",
    insuredPerson: "client",
    ownerRef: { ref: "person", role: "client" },
    faceValue: 500000,
    cashValue: 42000,
    costBasis: 30000,
    premiumAmount: 6000,
    premiumPayer: "client",
    ...fields,
  });
}

/** The line with one field unticked — the advisor isn't writing it. */
const untick = (line: ChangeLine, key: string): ChangeLine => ({
  ...line,
  fields: line.fields.map((f) => (f.key === key ? { ...f, ticked: false } : f)),
});

/** A universal life policy with a two-year cash value schedule, made the way the Details dialog makes one (no transaction). */
async function seedPolicy(seed: SaveSeed): Promise<string> {
  const made = await createInsurancePolicyForClient({
    clientId: seed.clientId,
    firmId: FIRM,
    actorId: SAVE_ACTOR,
    input: {
      name: "Prudential UL",
      policyType: "universal",
      insuredPerson: "client",
      ownerRef: { kind: "family", id: seed.clientMemberId },
      faceValue: 250000,
      cashValue: 18000,
      cashValueGrowthMode: "free_form",
      cashValueSchedule: [
        { year: 2030, cashValue: 20000 },
        { year: 2031, cashValue: 22000 },
      ],
    },
  });
  if (!made.ok) throw new Error(made.error);
  await db.delete(auditLog).where(eq(auditLog.clientId, seed.clientId));
  return made.resourceId;
}

async function policyOf(id: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
  const [policy] = await db.select().from(lifeInsurancePolicies).where(eq(lifeInsurancePolicies.accountId, id));
  const owners = await db
    .select({ familyMemberId: accountOwners.familyMemberId, entityId: accountOwners.entityId, percent: accountOwners.percent })
    .from(accountOwners)
    .where(eq(accountOwners.accountId, id));
  const schedule = await db
    .select({ year: lifeInsuranceCashValueSchedule.year, cashValue: lifeInsuranceCashValueSchedule.cashValue })
    .from(lifeInsuranceCashValueSchedule)
    .where(eq(lifeInsuranceCashValueSchedule.policyId, id))
    .orderBy(asc(lifeInsuranceCashValueSchedule.year));
  return { account, policy, owners, schedule };
}

const auditOf = (clientId: string) =>
  db
    .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(eq(auditLog.clientId, clientId));

d("life insurance policy writer", () => {
  beforeAll(() => dropSaveFirm(FIRM));
  afterAll(() => dropSaveFirm(FIRM));

  it("a Create commits the policy, its owner, the carrier and last 4, and its audit row", async () => {
    const seed = await seedSaveClient(FIRM);
    const { result: id, queued } = await inSave(at(seed), (ctx) => writer.create(ctx, inputOf(wholeLife(), people(seed))));

    const p = await policyOf(id);
    expect(p.account).toMatchObject({
      clientId: seed.clientId,
      scenarioId: seed.scenarioId,
      name: "Northwestern Whole Life",
      category: "life_insurance",
      subType: "whole_life",
      insuredPerson: "client",
      value: "42000.00",
    });
    expect(p.policy).toMatchObject({
      carrier: "Northwestern Mutual",
      policyNumberLast4: "9012",
      policyType: "whole",
      faceValue: "500000.00",
      costBasis: "30000.00",
      premiumAmount: "6000.00",
      premiumPayer: "client",
    });
    expect(p.owners).toEqual([{ familyMemberId: seed.clientMemberId, entityId: null, percent: "1.0000" }]);
    expect(await auditOf(seed.clientId)).toEqual([
      { action: "insurance_policy.create", resourceId: id, actorId: SAVE_ACTOR, metadata: { name: "Northwestern Whole Life", policyType: "whole" } },
    ]);
    expect(queued).toBe(0);
  });

  it("an Update writes only the line's keys and the carrier and last 4 — an unticked owner and the cash value schedule stay", async () => {
    const seed = await seedSaveClient(FIRM);
    const policyId = await seedPolicy(seed);
    const [trust] = await db.insert(entities).values({ clientId: seed.clientId, name: "Hendricks ILIT" }).returning({ id: entities.id });
    const line = untick(
      changeLine(
        "life_insurance_policy",
        {
          faceValue: 300000,
          premiumAmount: 4800,
          carrier: "Prudential",
          policyNumberLast4: "4417",
          ownerRef: { ref: "record", target: "entity", id: trust.id },
        },
        { recordId: policyId },
      ),
      "ownerRef",
    );

    const { queued } = await inSave(at(seed), (ctx) => writer.update(ctx, inputOf(line)));

    const p = await policyOf(policyId);
    expect(p.policy).toMatchObject({
      faceValue: "300000.00",
      premiumAmount: "4800.00",
      carrier: "Prudential",
      policyNumberLast4: "4417",
      policyType: "universal",
      cashValueGrowthMode: "free_form",
    });
    expect(p.account).toMatchObject({ name: "Prudential UL", value: "18000.00", subType: "universal_life" });
    expect(p.owners).toEqual([{ familyMemberId: seed.clientMemberId, entityId: null, percent: "1.0000" }]);
    expect(p.schedule).toEqual([
      { year: 2030, cashValue: "20000.00" },
      { year: 2031, cashValue: "22000.00" },
    ]);
    expect(await auditOf(seed.clientId)).toEqual([
      {
        action: "insurance_policy.update",
        resourceId: policyId,
        actorId: SAVE_ACTOR,
        metadata: { name: "Prudential UL", fieldsChanged: ["faceValue", "premiumAmount"] },
      },
    ]);
    expect(queued).toBe(0);
  });

  it("rolled back, nothing remains — a policy the save made and then updated, and an update of one on record", async () => {
    const seed = await seedSaveClient(FIRM);
    const policyId = await seedPolicy(seed);

    const { result } = await inSave(
      at(seed),
      async (ctx) => {
        const newId = await writer.create(ctx, inputOf(wholeLife(), people(seed)));
        await writer.update(ctx, inputOf(changeLine("life_insurance_policy", { faceValue: 750000, carrier: "MassMutual" }, { recordId: newId })));
        await writer.update(
          ctx,
          inputOf(changeLine("life_insurance_policy", { faceValue: 300000, carrier: "Prudential", policyNumberLast4: "4417" }, { recordId: policyId })),
        );
        const [onTx] = await ctx.tx.select().from(lifeInsurancePolicies).where(eq(lifeInsurancePolicies.accountId, newId));
        return { newId, onTx };
      },
      { rollback: true },
    );

    // On the transaction the update of the new policy found it and took.
    expect(result.onTx).toMatchObject({ faceValue: "750000.00", carrier: "MassMutual" });
    expect(await db.select().from(accounts).where(eq(accounts.id, result.newId))).toEqual([]);
    expect(await db.select().from(accountOwners).where(eq(accountOwners.accountId, result.newId))).toEqual([]);
    expect((await policyOf(policyId)).policy).toMatchObject({ faceValue: "250000.00", carrier: null, policyNumberLast4: null });
    expect(await auditOf(seed.clientId)).toEqual([]);
  });

  it("a new policy, and one on record, owned by a trust written earlier in the save", async () => {
    const seed = await seedSaveClient(FIRM);
    const policyId = await seedPolicy(seed);
    const { result } = await inSave(at(seed), async (ctx) => {
      // The row the trust's own line writes first (Task 11's writer isn't in this task; the row is what proves the check reads the transaction).
      const [trust] = await ctx.tx.insert(entities).values({ clientId: seed.clientId, name: "Hendricks ILIT" }).returning({ id: entities.id });
      const ids = { "line:trust-1": trust.id };
      const owner: PlacedValue = { ref: "line", target: "entity", lineId: "trust-1" };
      const id = await writer.create(ctx, inputOf(wholeLife({ ownerRef: owner }), ids));
      await writer.update(ctx, inputOf(changeLine("life_insurance_policy", { ownerRef: owner }, { recordId: policyId }), ids));
      return { id, trustId: trust.id };
    });

    const trustOwned = [{ familyMemberId: null, entityId: result.trustId, percent: "1.0000" }];
    expect((await policyOf(result.id)).owners).toEqual(trustOwned);
    expect((await policyOf(policyId)).owners).toEqual(trustOwned);
  });

  it("joint policies, new and on record, on a household whose co-client was added earlier in the save are owned by both", async () => {
    const seed = await seedSaveClient(FIRM);
    const policyId = await seedPolicy(seed);
    const { result } = await inSave(at(seed), async (ctx) => {
      // The co-client's family member, as the household line leaves it on the transaction (Task 5's writer isn't in this task).
      const [laura] = await ctx.tx
        .insert(familyMembers)
        .values({ clientId: seed.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other", dateOfBirth: "1970-09-30" })
        .returning({ id: familyMembers.id });
      const id = await writer.create(ctx, inputOf(wholeLife({ insuredPerson: "joint", ownerRef: "joint", premiumPayer: "both" }), people(seed)));
      await writer.update(ctx, inputOf(changeLine("life_insurance_policy", { ownerRef: "joint" }, { recordId: policyId })));
      return { id, lauraId: laura.id };
    });

    const both = [
      { familyMemberId: seed.clientMemberId, entityId: null, percent: "0.5000" },
      { familyMemberId: result.lauraId, entityId: null, percent: "0.5000" },
    ];
    const created = await policyOf(result.id);
    expect(created.account.insuredPerson).toBe("joint");
    expect(created.owners).toHaveLength(2);
    expect(created.owners).toEqual(expect.arrayContaining(both));
    const onRecord = await policyOf(policyId);
    expect(onRecord.owners).toHaveLength(2);
    expect(onRecord.owners).toEqual(expect.arrayContaining(both));
  });

  it("refuses a carrier over 200 characters or a last 4 that isn't four digits, before anything is written", async () => {
    const seed = await seedSaveClient(FIRM);
    const { result } = await inSave(
      at(seed),
      async (ctx) => {
        // Caught inside the save: the transaction is still usable, and shows what the refused lines wrote.
        const refused = [];
        for (const line of [wholeLife({ carrier: "x".repeat(201) }), wholeLife({ policyNumberLast4: "12" })]) {
          refused.push(await writer.create(ctx, inputOf(line, people(seed))).catch((err: unknown) => err));
        }
        const onTx = await ctx.tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.clientId, seed.clientId), eq(accounts.category, "life_insurance")));
        return { refused, onTx };
      },
      { rollback: true },
    );

    expect(result.refused).toMatchObject([
      { name: "SaveLineError", message: "Carrier: a name of up to 200 characters." },
      { name: "SaveLineError", message: "Policy # (last 4): the policy number's last four digits." },
    ]);
    expect(result.onTx).toEqual([]);
  });

  describe("a policy on record with no details row (Data Collection adds a bare life insurance account)", () => {
    const bare = async (seed: SaveSeed) =>
      (
        await db
          .insert(accounts)
          .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Old policy", category: "life_insurance", subType: "term" })
          .returning({ id: accounts.id })
      )[0].id;

    it("refuses ticked details that would go nowhere, naming them, before the core writes anything — unticked, the rest saves", async () => {
      const seed = await seedSaveClient(FIRM);
      const id = await bare(seed);
      const line = changeLine("life_insurance_policy", { name: "MetLife Term", faceValue: 500000, premiumAmount: 6000 }, { recordId: id });

      const { result } = await inSave(
        at(seed),
        async (ctx) => {
          const refused = await writer.update(ctx, inputOf(line)).catch((err: unknown) => err);
          const [account] = await ctx.tx.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, id));
          const audit = await ctx.tx.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.clientId, seed.clientId));
          return { refused, name: account.name, audit };
        },
        { rollback: true },
      );
      expect(result.refused).toMatchObject({
        name: "SaveLineError",
        message: "This policy has no details on the plan, so “Death benefit” and “Annual premium” can't be saved by an update — untick them to save the rest.",
      });
      expect(result).toMatchObject({ name: "Old policy", audit: [] });

      await inSave(at(seed), (ctx) => writer.update(ctx, inputOf(untick(untick(line, "faceValue"), "premiumAmount"))));
      expect((await policyOf(id)).account.name).toBe("MetLife Term");
    });

    it("refuses its carrier and last 4 the same way, rather than drop them — one alone is “it”", async () => {
      const seed = await seedSaveClient(FIRM);
      const id = await bare(seed);
      const line = changeLine("life_insurance_policy", { carrier: "MetLife", policyNumberLast4: "1234" }, { recordId: id });

      await expect(inSave(at(seed), (ctx) => writer.update(ctx, inputOf(line)))).rejects.toMatchObject({
        name: "SaveLineError",
        message: "This policy has no details on the plan, so “Carrier” and “Policy # (last 4)” can't be saved by an update — untick them to save the rest.",
      });
      await expect(inSave(at(seed), (ctx) => writer.update(ctx, inputOf(untick(line, "policyNumberLast4"))))).rejects.toMatchObject({
        name: "SaveLineError",
        message: "This policy has no details on the plan, so “Carrier” can't be saved by an update — untick it to save the rest.",
      });
      expect(await auditOf(seed.clientId)).toEqual([]);
    });
  });

  it("a new policy owned by the co-client the save added earlier: the owner check reads the transaction", async () => {
    const seed = await seedSaveClient(FIRM);
    const { result } = await inSave(at(seed), async (ctx) => {
      // The co-client's family member, as the household line leaves it on the transaction.
      const [laura] = await ctx.tx
        .insert(familyMembers)
        .values({ clientId: seed.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other", dateOfBirth: "1970-09-30" })
        .returning({ id: familyMembers.id });
      const id = await writer.create(ctx, inputOf(wholeLife({ insuredPerson: "spouse", ownerRef: { ref: "person", role: "spouse" } }), { "person:spouse": laura.id }));
      return { id, lauraId: laura.id };
    });

    expect((await policyOf(result.id)).owners).toEqual([{ familyMemberId: result.lauraId, entityId: null, percent: "1.0000" }]);
  });

  it("without a transaction the core answers as the routes did", async () => {
    const seed = await seedSaveClient(FIRM);
    const other = await seedSaveClient(FIRM);
    const [theirTrust] = await db.insert(entities).values({ clientId: other.clientId, name: "Another family's trust" }).returning({ id: entities.id });
    const policyId = await seedPolicy(seed);
    const args = { clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR };
    const policy = { name: "Whole life", policyType: "whole", insuredPerson: "client", ownerRef: { kind: "joint" }, faceValue: 1000 };

    expect(await createInsurancePolicyForClient({ ...args, input: { ...policy, ownerRef: { kind: "entity", id: theirTrust.id } } })).toEqual({
      ok: false,
      status: 400,
      error: `Entity ${theirTrust.id} not owned by this client`,
    });
    expect(await createInsurancePolicyForClient({ ...args, input: { ...policy, policyType: "term", termLengthYears: 20 } })).toEqual({
      ok: false,
      status: 400,
      error: "Invalid body",
      body: { error: "Invalid body", issues: [{ path: "termIssueYear", message: "Term policies need a term issue year" }] },
    });
    expect(await updateInsurancePolicyForClient({ ...args, policyId: randomUUID(), input: { faceValue: 1 } })).toEqual({
      ok: false,
      status: 404,
      error: "Policy not found",
    });
    expect(await updateInsurancePolicyForClient({ ...args, policyId, input: { faceValue: -1 } })).toMatchObject({
      ok: false,
      status: 400,
      error: "Invalid body",
      body: { error: "Invalid body", issues: [{ path: "faceValue" }] },
    });
    expect(await updateInsurancePolicyForClient({ ...args, policyId, input: { faceValue: 260000 } })).toEqual({
      ok: true,
      data: { id: policyId },
      resourceId: policyId,
    });
    expect((await policyOf(policyId)).policy.faceValue).toBe("260000.00");
  });
});
