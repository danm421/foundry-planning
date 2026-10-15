// src/lib/fact-finder/save/__tests__/writers-gifts.test.ts
//
// The prior gift save writer on a real transaction (live dev database): the
// Details write path's rows and audit rows commit or roll back with the save,
// and a gift can go to a trust, a charity or a family member created earlier in
// the same save. The trust, charity and family member are inserted straight on
// the transaction — those writers are built apart from this one.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, entities, externalBeneficiaries, familyMembers, gifts } from "@/db/schema";
import { GIFT_WRITERS } from "../writers/gifts";
import { SaveLineError } from "../types";
import { changeLine, dropSaveFirm, inputOf, inSave, seedSaveClient, type SaveSeed } from "./harness";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_gifts", orgRole: "org:admin" }),
}));

const FIRM = "firm_test_ff_save_gifts";
const writer = GIFT_WRITERS.gift;
let seed: SaveSeed;
let scope: { clientId: string; firmId: string };

beforeAll(async () => {
  await dropSaveFirm(FIRM);
  seed = await seedSaveClient(FIRM, { coClient: true });
  scope = { clientId: seed.clientId, firmId: FIRM };
});
afterAll(() => dropSaveFirm(FIRM));

const NOTES = "Given: Stock. Form 709 filed: Yes.";
const giftRow = async (id: string) => (await db.select().from(gifts).where(eq(gifts.id, id)))[0];
const auditOf = (id: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.resourceId, id), eq(auditLog.action, action)));

type Tx = Parameters<Parameters<typeof inSave>[1]>[0]["tx"];
/** What the trusts, charities and family tasks write earlier in a save: inserted straight on the transaction. */
async function recipients(tx: Tx) {
  const [trust] = await tx
    .insert(entities)
    .values({ clientId: seed.clientId, name: "Hendricks ILIT", entityType: "trust", isIrrevocable: true })
    .returning({ id: entities.id });
  const [charity] = await tx
    .insert(externalBeneficiaries)
    .values({ clientId: seed.clientId, name: "Food Bank" })
    .returning({ id: externalBeneficiaries.id });
  const [child] = await tx
    .insert(familyMembers)
    .values({ clientId: seed.clientId, firstName: "Emma", relationship: "child" })
    .returning({ id: familyMembers.id });
  return { trustId: trust.id, charityId: charity.id, childId: child.id };
}

const recipientRef = (target: "entity" | "external_beneficiary" | "family_member", lineId: string) =>
  ({ ref: "line", target, lineId }) as const;

describe("prior gift save writer", () => {
  it("(a) create and update commit: the gift, its notes and both audit rows are there", async () => {
    const child = recipientRef("family_member", "L-child");
    let id = "";
    let childId = "";
    await inSave(scope, async (ctx) => {
      ({ childId } = await recipients(ctx.tx));
      const line = changeLine("gift", { year: 2021, grantor: "joint", recipient: child, amount: 16000, notes: NOTES }, { dependsOn: ["L-child"] });
      id = await writer.create(ctx, inputOf(line, { "line:L-child": childId }));
    });
    const row = await giftRow(id);
    expect(row).toMatchObject({ year: 2021, grantor: "joint", recipientFamilyMemberId: childId, recipientEntityId: null, recipientExternalBeneficiaryId: null, notes: NOTES, accountId: null, liabilityId: null });
    expect(Number(row.amount)).toBe(16000);
    expect(await auditOf(id, "gift.create")).toHaveLength(1);

    // Update: only the amount is on the line — everything else stays.
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(changeLine("gift", { amount: 18000 }, { recordId: id }))));
    const after = await giftRow(id);
    expect(Number(after.amount)).toBe(18000);
    expect(after).toMatchObject({ year: 2021, grantor: "joint", recipientFamilyMemberId: childId, notes: NOTES });
    expect(await auditOf(id, "gift.update")).toHaveLength(1);
  });

  it("(b) a save that then throws leaves no gift and no audit row", async () => {
    let id = "";
    await inSave(
      scope,
      async (ctx) => {
        const { childId } = await recipients(ctx.tx);
        id = await writer.create(ctx, inputOf(changeLine("gift", { year: 2019, grantor: "client", recipient: recipientRef("family_member", "L-c"), amount: 5000 }, { dependsOn: ["L-c"] }), { "line:L-c": childId }));
        await writer.update(ctx, inputOf(changeLine("gift", { amount: 6000 }, { recordId: id })));
      },
      { rollback: true },
    );
    expect(id).not.toBe("");
    expect(await giftRow(id)).toBeUndefined();
    expect(await db.select().from(auditLog).where(eq(auditLog.resourceId, id))).toHaveLength(0);
  });

  it("(c) gifts to a trust, a charity and a family member, each created earlier in the save", async () => {
    const ids: string[] = [];
    let r!: Awaited<ReturnType<typeof recipients>>;
    await inSave(scope, async (ctx) => {
      r = await recipients(ctx.tx);
      const map = { "line:L-t": r.trustId, "line:L-x": r.charityId, "line:L-f": r.childId };
      for (const [recipient, lineId] of [
        [recipientRef("entity", "L-t"), "L-t"],
        [recipientRef("external_beneficiary", "L-x"), "L-x"],
        [recipientRef("family_member", "L-f"), "L-f"],
      ] as const) {
        ids.push(await writer.create(ctx, inputOf(changeLine("gift", { year: 2022, grantor: "client", recipient, amount: 10000 }, { dependsOn: [lineId] }), map)));
      }
    });
    const [toTrust, toCharity, toChild] = await Promise.all(ids.map(giftRow));
    expect(toTrust).toMatchObject({ recipientEntityId: r.trustId, recipientExternalBeneficiaryId: null, recipientFamilyMemberId: null });
    expect(toCharity).toMatchObject({ recipientEntityId: null, recipientExternalBeneficiaryId: r.charityId, recipientFamilyMemberId: null });
    expect(toChild).toMatchObject({ recipientEntityId: null, recipientExternalBeneficiaryId: null, recipientFamilyMemberId: r.childId });
  });

  it("(c) an update that moves a gift to a charity created earlier in the save clears the old recipient", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      const { childId } = await recipients(ctx.tx);
      id = await writer.create(ctx, inputOf(changeLine("gift", { year: 2020, grantor: "client", recipient: recipientRef("family_member", "L-f"), amount: 3000 }, { dependsOn: ["L-f"] }), { "line:L-f": childId }));
    });
    let charityId = "";
    await inSave(scope, async (ctx) => {
      ({ charityId } = await recipients(ctx.tx));
      await writer.update(ctx, inputOf(changeLine("gift", { recipient: recipientRef("external_beneficiary", "L-x") }, { recordId: id, dependsOn: ["L-x"] }), { "line:L-x": charityId }));
    });
    expect(await giftRow(id)).toMatchObject({ recipientEntityId: null, recipientFamilyMemberId: null, recipientExternalBeneficiaryId: charityId });
  });

  it("(c) the same gifts in a save that rolls back leave neither the gift nor its recipient", async () => {
    let id = "";
    let trustId = "";
    await inSave(
      scope,
      async (ctx) => {
        ({ trustId } = await recipients(ctx.tx));
        id = await writer.create(ctx, inputOf(changeLine("gift", { year: 2018, grantor: "client", recipient: recipientRef("entity", "L-t"), amount: 1000 }, { dependsOn: ["L-t"] }), { "line:L-t": trustId }));
      },
      { rollback: true },
    );
    expect(await giftRow(id)).toBeUndefined();
    expect(await db.select().from(entities).where(eq(entities.id, trustId))).toHaveLength(0);
  });

  it("(c) three gifts in one save are all written (their created-at times tie)", async () => {
    const ids: string[] = [];
    await inSave(scope, async (ctx) => {
      const { childId } = await recipients(ctx.tx);
      for (const year of [2016, 2016, 2017]) {
        ids.push(await writer.create(ctx, inputOf(changeLine("gift", { year, grantor: "client", recipient: recipientRef("family_member", "L-f"), amount: 1000 }, { dependsOn: ["L-f"] }), { "line:L-f": childId })));
      }
    });
    expect(new Set(ids).size).toBe(3);
    expect((await Promise.all(ids.map(giftRow))).map((g) => g.year)).toEqual([2016, 2016, 2017]);
  });

  it("refuses a revocable trust, naming the Details reason", async () => {
    await expect(
      inSave(scope, async (ctx) => {
        const [trust] = await ctx.tx.insert(entities).values({ clientId: seed.clientId, name: "Living trust", entityType: "trust", isIrrevocable: false }).returning({ id: entities.id });
        await writer.create(ctx, inputOf(changeLine("gift", { year: 2020, grantor: "client", recipient: recipientRef("entity", "L-t"), amount: 1000 }, { dependsOn: ["L-t"] }), { "line:L-t": trust.id }));
      }),
    ).rejects.toThrow(/revocable trusts are not completed gifts/);
  });

  it("refuses a recipient that isn't this client's", async () => {
    const other = await seedSaveClient(FIRM);
    const [foreign] = await db.insert(externalBeneficiaries).values({ clientId: other.clientId, name: "Not theirs" }).returning({ id: externalBeneficiaries.id });
    const line = changeLine("gift", { year: 2020, grantor: "client", recipient: { ref: "record", target: "external_beneficiary", id: foreign.id }, amount: 1000 });
    const run = () => inSave(scope, (ctx) => writer.create(ctx, inputOf(line)));
    await expect(run()).rejects.toThrow(SaveLineError);
    await expect(run()).rejects.toThrow(/not found for this client/);
  });

  it("an update with no record is refused", async () => {
    await expect(inSave(scope, (ctx) => writer.update(ctx, { ...inputOf(changeLine("gift", { amount: 5 })), recordId: null }))).rejects.toThrow(SaveLineError);
  });

  it("(e) a gift save queues no after-commit work", async () => {
    const saved = await inSave(scope, async (ctx) => {
      const { childId } = await recipients(ctx.tx);
      return writer.create(ctx, inputOf(changeLine("gift", { year: 2020, grantor: "client", recipient: recipientRef("family_member", "L-f"), amount: 1000 }, { dependsOn: ["L-f"] }), { "line:L-f": childId }));
    });
    expect(saved.queued).toBe(0);
  });
});
