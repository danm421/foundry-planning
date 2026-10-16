// src/lib/fact-finder/save/__tests__/writers-trusts.test.ts
//
// Live dev database: the trusts writers (Plan 4, Task 11) on a real
// transaction — an irrevocable trust through the entities core (moved out of
// POST /entities and PUT /entities/[entityId]) and a revocable living trust
// through the revocable-trusts core. Each write commits with its audit row, or
// rolls back without a trace; a trust created in the save has its default cash
// account and that account's owner row on the save's transaction; an update
// writes only the line's keys; a revocable trust renamed keeps its accounts.
// Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_trusts", orgRole: "org:admin" }),
}));

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountOwners, accounts, auditLog, entities, externalBeneficiaries, gifts, revocableTrusts, trustSplitInterestDetails } from "@/db/schema";
import { createEntityForClient } from "@/lib/clients/entities-writes";
import { createRevocableTrustForClient } from "@/lib/clients/revocable-trusts-writes";
import { SaveLineError } from "../types";
import { TRUST_WRITERS } from "../writers/trusts";
import { SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_trusts";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

/** What the Trusts section fixes on every irrevocable trust it creates. */
const TRUST = { entityType: "trust", isIrrevocable: true };
const rollback = { rollback: true };

const at = (seed: SaveSeed) => ({ clientId: seed.clientId, firmId: FIRM });

async function auditOf(clientId: string) {
  return db
    .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(eq(auditLog.clientId, clientId));
}

/** An entity's default cash accounts and their owner rows, read on `handle`. */
async function cashOf(entityId: string, handle: Pick<typeof db, "select"> = db) {
  return handle
    .select({
      accountId: accounts.id,
      scenarioId: accounts.scenarioId,
      name: accounts.name,
      category: accounts.category,
      isDefaultChecking: accounts.isDefaultChecking,
      ownerEntityId: accountOwners.entityId,
      percent: accountOwners.percent,
    })
    .from(accountOwners)
    .innerJoin(accounts, eq(accounts.id, accountOwners.accountId))
    .where(eq(accountOwners.entityId, entityId));
}

async function entityOf(id: string) {
  const [row] = await db.select().from(entities).where(eq(entities.id, id));
  return row;
}

d("trust writers", () => {
  beforeAll(() => dropSaveFirm(FIRM));
  afterAll(() => dropSaveFirm(FIRM));

  describe("entity — an irrevocable trust", () => {
    it("a Create commits the trust, a cash account it owns and its audit row — on the save's transaction", async () => {
      const seed = await seedSaveClient(FIRM);
      const ilit = changeLine(
        "entity",
        { name: "Hendricks ILIT", trustSubType: "ilit", grantor: "client", trustee: "Jane Smith", crummeyPowers: true, trustEnds: "survivorship" },
        { fixed: TRUST },
      );
      const dynasty = changeLine("entity", { name: "Hendricks Dynasty Trust", trustSubType: "irrevocable", grantor: "none", isGrantor: true }, { fixed: TRUST });

      const { result, queued } = await inSave(at(seed), async (ctx) => {
        const ilitId = await TRUST_WRITERS.entity.create(ctx, inputOf(ilit));
        const dynastyId = await TRUST_WRITERS.entity.create(ctx, inputOf(dynasty));
        // A later line of the same save finds each trust's cash account and its owner row.
        return { ilitId, dynastyId, cashOnTx: await cashOf(ilitId, ctx.tx), dynastyCashOnTx: await cashOf(dynastyId, ctx.tx) };
      });
      const { ilitId, dynastyId } = result;

      for (const [id, name, cashOnTx] of [
        [ilitId, "Hendricks ILIT", result.cashOnTx],
        [dynastyId, "Hendricks Dynasty Trust", result.dynastyCashOnTx],
      ] as const) {
        const cash = [{ accountId: expect.any(String), scenarioId: seed.scenarioId, name: `${name} — Cash`, category: "cash", isDefaultChecking: true, ownerEntityId: id, percent: "1.0000" }];
        expect(cashOnTx, `${name}, on the transaction`).toEqual(cash);
        expect(await cashOf(id), `${name}, committed`).toEqual(cash);
      }
      expect(await entityOf(ilitId)).toMatchObject({
        clientId: seed.clientId, name: "Hendricks ILIT", entityType: "trust", trustSubType: "ilit", isIrrevocable: true,
        grantor: "client", trustee: "Jane Smith", crummeyPowers: true, isGrantor: false, trustEnds: "survivorship", owner: null,
      });
      // "Someone else" saves as no grantor.
      expect(await entityOf(dynastyId)).toMatchObject({ name: "Hendricks Dynasty Trust", trustSubType: "irrevocable", grantor: null, isGrantor: true });

      const audit = await auditOf(seed.clientId);
      expect(audit).toHaveLength(2);
      expect(audit).toContainEqual({ action: "entity.create", resourceId: ilitId, actorId: SAVE_ACTOR, metadata: { name: "Hendricks ILIT", entityType: "trust" } });
      expect(audit).toContainEqual({ action: "entity.create", resourceId: dynastyId, actorId: SAVE_ACTOR, metadata: { name: "Hendricks Dynasty Trust", entityType: "trust" } });
      expect(queued).toBe(0);
    });

    it("a Create in a save that then fails leaves no trust, no cash account and no audit row", async () => {
      const seed = await seedSaveClient(FIRM);
      const line = changeLine("entity", { name: "Hendricks ILIT", trustSubType: "ilit", grantor: "client" }, { fixed: TRUST });

      const { result } = await inSave(
        at(seed),
        async (ctx) => {
          const id = await TRUST_WRITERS.entity.create(ctx, inputOf(line));
          return { id, cash: await cashOf(id, ctx.tx) };
        },
        rollback,
      );

      expect(result.cash).toHaveLength(1);
      expect(await entityOf(result.id)).toBeUndefined();
      expect(await db.select().from(accounts).where(inArray(accounts.id, result.cash.map((c) => c.accountId)))).toEqual([]);
      expect(await db.select().from(accountOwners).where(eq(accountOwners.entityId, result.id))).toEqual([]);
      expect(await auditOf(seed.clientId)).toEqual([]);
    });

    it("an Update writes only the line's keys with its audit row — rolled back, nothing", async () => {
      const seed = await seedSaveClient(FIRM);
      const onRecord = await createEntityForClient({
        clientId: seed.clientId,
        firmId: FIRM,
        actorId: SAVE_ACTOR,
        input: { name: "Hendricks Dynasty Trust", entityType: "trust", trustSubType: "irrevocable", isIrrevocable: true, grantor: "client", trustee: "Jane Smith", crummeyPowers: true },
      });
      if (!onRecord.ok) throw new Error(onRecord.error);
      const id = onRecord.resourceId;
      await db.delete(auditLog).where(eq(auditLog.clientId, seed.clientId));
      const line = changeLine("entity", { trustee: "First Western Trust", trustEnds: "client_death" }, { recordId: id });

      await inSave(at(seed), (ctx) => TRUST_WRITERS.entity.update(ctx, inputOf(line)), rollback);
      expect(await entityOf(id)).toMatchObject({ trustee: "Jane Smith", trustEnds: null });
      expect(await auditOf(seed.clientId)).toEqual([]);

      const { queued } = await inSave(at(seed), (ctx) => TRUST_WRITERS.entity.update(ctx, inputOf(line)));
      expect(await entityOf(id)).toMatchObject({
        name: "Hendricks Dynasty Trust", trustSubType: "irrevocable", isIrrevocable: true, grantor: "client", crummeyPowers: true,
        trustee: "First Western Trust", trustEnds: "client_death",
      });
      expect(await auditOf(seed.clientId)).toEqual([
        { action: "entity.update", resourceId: id, actorId: SAVE_ACTOR, metadata: { name: "Hendricks Dynasty Trust", entityType: "trust" } },
      ]);
      expect(queued).toBe(0);
    });

    it("an Update of a charitable lead trust on record keeps its split-interest terms and its remainder gift", async () => {
      const seed = await seedSaveClient(FIRM);
      const [charity] = await db.insert(externalBeneficiaries).values({ clientId: seed.clientId, name: "Denver Foundation", kind: "charity", charityType: "public" }).returning();
      const onRecord = await createEntityForClient({
        clientId: seed.clientId,
        firmId: FIRM,
        actorId: SAVE_ACTOR,
        input: {
          name: "Hendricks CLT", entityType: "trust", trustSubType: "clt", isIrrevocable: true, grantor: "client",
          splitInterest: { inceptionYear: 2026, inceptionValue: 1_000_000, payoutType: "unitrust", payoutPercent: 0.06, irc7520Rate: 0.022, termType: "years", termYears: 10, charityId: charity.id },
        },
      });
      if (!onRecord.ok) throw new Error(onRecord.error);
      const id = onRecord.resourceId;
      const terms = () => db.select().from(trustSplitInterestDetails).where(eq(trustSplitInterestDetails.entityId, id));
      const remainderGift = () => db.select().from(gifts).where(and(eq(gifts.recipientEntityId, id), eq(gifts.eventKind, "clt_remainder_interest")));
      const [termsBefore, giftsBefore] = [await terms(), await remainderGift()];
      expect(giftsBefore).toHaveLength(1);

      // The PUT validates the trust as it would stand, its terms hydrated from the record.
      await inSave(at(seed), (ctx) => TRUST_WRITERS.entity.update(ctx, inputOf(changeLine("entity", { trustee: "Denver Foundation" }, { recordId: id }))));

      expect(await entityOf(id)).toMatchObject({ trustSubType: "clt", grantor: "client", trustee: "Denver Foundation" });
      expect(await terms()).toEqual(termsBefore);
      expect(await remainderGift()).toEqual(giftsBefore);
    });

    it("an Update never changes a charitable lead trust's grantor — to the co-client or to no one — so its remainder gift can't be left behind", async () => {
      const seed = await seedSaveClient(FIRM, { coClient: true });
      const [charity] = await db.insert(externalBeneficiaries).values({ clientId: seed.clientId, name: "Denver Foundation", kind: "charity", charityType: "public" }).returning();
      const onRecord = await createEntityForClient({
        clientId: seed.clientId,
        firmId: FIRM,
        actorId: SAVE_ACTOR,
        input: {
          name: "Hendricks CLT", entityType: "trust", trustSubType: "clt", isIrrevocable: true, grantor: "client",
          splitInterest: { inceptionYear: 2026, inceptionValue: 1_000_000, payoutType: "unitrust", payoutPercent: 0.06, irc7520Rate: 0.022, termType: "years", termYears: 10, charityId: charity.id },
        },
      });
      if (!onRecord.ok) throw new Error(onRecord.error);
      const id = onRecord.resourceId;
      const giftGrantor = async () =>
        (await db.select({ grantor: gifts.grantor }).from(gifts).where(and(eq(gifts.recipientEntityId, id), eq(gifts.eventKind, "clt_remainder_interest")))).map((g) => g.grantor);

      const refused = [];
      for (const grantor of ["spouse", "none"]) {
        const line = changeLine("entity", { grantor, trustee: "Denver Foundation" }, { recordId: id });
        refused.push(await inSave(at(seed), (ctx) => TRUST_WRITERS.entity.update(ctx, inputOf(line))).then(() => `saved grantor ${grantor}`, (err: unknown) => err));
      }
      const REFUSED = { name: "SaveLineError", message: "A charitable lead or remainder trust's grantor changes in Details — its remainder gift moves with it." };
      expect(refused).toMatchObject([REFUSED, REFUSED]);
      expect(await entityOf(id)).toMatchObject({ grantor: "client", trustee: null });
      expect(await giftGrantor()).toEqual(["client"]);
    });

    it("an Update line with no record refuses in the advisor's words", async () => {
      const seed = await seedSaveClient(FIRM);
      const input = { ...inputOf(changeLine("entity", { trustee: "First Western Trust" }, { recordId: randomUUID() })), recordId: null };
      for (const writer of [TRUST_WRITERS.entity, TRUST_WRITERS.revocable_trust]) {
        await expect(inSave(at(seed), (ctx) => writer.update(ctx, input))).rejects.toMatchObject({ name: "SaveLineError", message: "The trust to change isn't on the plan." });
      }
    });

    it("a trust the write path can't find refuses the line with its message", async () => {
      const seed = await seedSaveClient(FIRM);
      const line = changeLine("entity", { trustee: "First Western Trust" }, { recordId: randomUUID() });

      const refused = inSave(at(seed), (ctx) => TRUST_WRITERS.entity.update(ctx, inputOf(line)));
      await expect(refused).rejects.toThrow(SaveLineError);
      await expect(refused).rejects.toThrow("Entity not found");
    });
  });

  describe("revocable_trust — a revocable living trust", () => {
    it("a Create commits the trust with its audit row — rolled back, nothing", async () => {
      const seed = await seedSaveClient(FIRM);
      const kept = changeLine("revocable_trust", { name: "Hendricks Family Trust" });
      const dropped = changeLine("revocable_trust", { name: "Hendricks Living Trust" });

      const { result: droppedId } = await inSave(at(seed), (ctx) => TRUST_WRITERS.revocable_trust.create(ctx, inputOf(dropped)), rollback);
      const { result: id, queued } = await inSave(at(seed), (ctx) => TRUST_WRITERS.revocable_trust.create(ctx, inputOf(kept)));

      expect(await db.select({ id: revocableTrusts.id }).from(revocableTrusts).where(eq(revocableTrusts.id, droppedId))).toEqual([]);
      expect(await db.select({ clientId: revocableTrusts.clientId, name: revocableTrusts.name }).from(revocableTrusts).where(eq(revocableTrusts.id, id))).toEqual([
        { clientId: seed.clientId, name: "Hendricks Family Trust" },
      ]);
      expect(await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.revocableTrustId, id))).toEqual([]);
      expect(await auditOf(seed.clientId)).toEqual([
        { action: "revocable_trust.create", resourceId: id, actorId: SAVE_ACTOR, metadata: { name: "Hendricks Family Trust", accountIds: [] } },
      ]);
      expect(queued).toBe(0);
    });

    it("an Update renames the trust and keeps every account it holds — rolled back, nothing", async () => {
      const seed = await seedSaveClient(FIRM);
      const [brokerage] = await db
        .insert(accounts)
        .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" })
        .returning({ id: accounts.id });
      const [cash] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.clientId, seed.clientId), eq(accounts.isDefaultChecking, true)));
      const held = [brokerage.id, cash.id].sort();
      const onRecord = await createRevocableTrustForClient({ clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR, input: { name: "Hendricks Family Trust", accountIds: held } });
      if (!onRecord.ok) throw new Error(onRecord.error);
      const id = onRecord.resourceId;
      await db.delete(auditLog).where(eq(auditLog.clientId, seed.clientId));
      const heldNow = async () => (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.revocableTrustId, id))).map((a) => a.id).sort();
      const nameNow = async () => (await db.select({ name: revocableTrusts.name }).from(revocableTrusts).where(eq(revocableTrusts.id, id)))[0].name;
      // The line carries the name only — a PATCH without account ids would untag every account.
      const line = changeLine("revocable_trust", { name: "Hendricks Living Trust" }, { recordId: id });
      expect(inputOf(line).body).toEqual({ name: "Hendricks Living Trust" });

      await inSave(at(seed), (ctx) => TRUST_WRITERS.revocable_trust.update(ctx, inputOf(line)), rollback);
      expect(await nameNow()).toBe("Hendricks Family Trust");
      expect(await heldNow()).toEqual(held);
      expect(await auditOf(seed.clientId)).toEqual([]);

      await inSave(at(seed), (ctx) => TRUST_WRITERS.revocable_trust.update(ctx, inputOf(line)));
      expect(await nameNow()).toBe("Hendricks Living Trust");
      expect(await heldNow()).toEqual(held);
      const audit = await auditOf(seed.clientId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "revocable_trust.update", resourceId: id, actorId: SAVE_ACTOR, metadata: { name: "Hendricks Living Trust" } });
      expect([...(audit[0].metadata as { accountIds: string[] }).accountIds].sort()).toEqual(held);
    });
  });
});
