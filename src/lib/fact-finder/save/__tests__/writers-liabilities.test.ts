// src/lib/fact-finder/save/__tests__/writers-liabilities.test.ts
//
// The liability save writer on a real transaction (live dev database): the
// Details write path's rows and audit rows commit or roll back with the save,
// the owners are the line's, a mortgage can sit on a property and belong to a
// trust created earlier in the same save, and the debt type — which the Details
// routes don't write — lands on create and update.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountOwners, accounts, auditLog, entities, familyMembers, liabilities, liabilityOwners } from "@/db/schema";
import { LIABILITY_WRITERS } from "../writers/liabilities";
import { SaveLineError } from "../types";
import { changeLine, dropSaveFirm, inputOf, inSave, seedSaveClient, type SaveSeed } from "./harness";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_liabilities", orgRole: "org:admin" }),
}));

const FIRM = "firm_test_ff_save_liabilities";
const writer = LIABILITY_WRITERS.liability;
let seed: SaveSeed;
let scope: { clientId: string; firmId: string };

beforeAll(async () => {
  await dropSaveFirm(FIRM);
  seed = await seedSaveClient(FIRM, { coClient: true });
  scope = { clientId: seed.clientId, firmId: FIRM };
});
afterAll(() => dropSaveFirm(FIRM));

const ids = () => ({ "person:client": seed.clientMemberId, "person:spouse": seed.spouseMemberId! });
const jointOwners = [
  { who: { ref: "person", role: "client" }, percent: 0.5 },
  { who: { ref: "person", role: "spouse" }, percent: 0.5 },
] as const;

const loanFields = (name: string) => ({
  name,
  liabilityType: "auto",
  balance: 18500,
  interestRate: 0.0649,
  monthlyPayment: 612,
  start: "2024-03",
  termMonths: 60,
  isInterestDeductible: false,
});

const liabilityRow = async (id: string) => (await db.select().from(liabilities).where(eq(liabilities.id, id)))[0];
const ownerRows = (id: string) => db.select().from(liabilityOwners).where(eq(liabilityOwners.liabilityId, id));
const auditOf = (id: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.resourceId, id), eq(auditLog.action, action)));

/** What Tasks 2 and 11 will write: a house with an owner row, and a trust. Inserted on the save's own transaction. */
async function houseAndTrust(tx: Parameters<Parameters<typeof inSave>[1]>[0]["tx"]) {
  const [house] = await tx
    .insert(accounts)
    .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Lake House", category: "real_estate", subType: "primary_residence", value: "900000" })
    .returning({ id: accounts.id });
  await tx.insert(accountOwners).values({ accountId: house.id, familyMemberId: seed.clientMemberId, percent: "1" });
  const [trust] = await tx.insert(entities).values({ clientId: seed.clientId, name: "Hendricks Family Trust", entityType: "trust" }).returning({ id: entities.id });
  return { houseId: house.id, trustId: trust.id };
}

describe("liability save writer", () => {
  it("(a) create and update commit: the loan, its type, its owners and both audit rows are there", async () => {
    const create = changeLine("liability", { ...loanFields("Truck loan"), owners: [...jointOwners] });
    let id = "";
    const saved = await inSave(scope, async (ctx) => {
      id = await writer.create(ctx, inputOf(create, ids()));
      return id;
    });
    expect(saved.result).toBe(id);
    const row = await liabilityRow(id);
    expect(row).toMatchObject({ name: "Truck loan", liabilityType: "auto", termMonths: 60, startYear: 2024, startMonth: 3, isInterestDeductible: false });
    expect(Number(row.balance)).toBe(18500);
    expect(Number(row.interestRate)).toBeCloseTo(0.0649, 4);
    expect(await auditOf(id, "liability.create")).toHaveLength(1);

    // Update: only the balance and the type are on the line.
    const update = changeLine("liability", { balance: 17000, liabilityType: "personal" }, { recordId: id });
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(update, ids())));
    const after = await liabilityRow(id);
    expect(Number(after.balance)).toBe(17000);
    expect(after.liabilityType).toBe("personal");
    expect(after.name).toBe("Truck loan");
    expect(Number(after.monthlyPayment)).toBe(612);
    const [update1] = await auditOf(id, "liability.update");
    expect(update1).toBeDefined();
  });

  it("(b) a save that then throws leaves no loan, no owner row and no audit row", async () => {
    let id = "";
    await inSave(
      scope,
      async (ctx) => {
        id = await writer.create(ctx, inputOf(changeLine("liability", { ...loanFields("Rolled-back loan"), owners: [...jointOwners] }), ids()));
        await writer.update(ctx, inputOf(changeLine("liability", { balance: 1 }, { recordId: id }), ids()));
      },
      { rollback: true },
    );
    expect(id).not.toBe("");
    expect(await liabilityRow(id)).toBeUndefined();
    expect(await ownerRows(id)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.resourceId, id))).toHaveLength(0);
  });

  it("(c) a mortgage on a house and owned by a trust, both created earlier in the save", async () => {
    let id = "";
    let trustId = "";
    let houseId = "";
    await inSave(scope, async (ctx) => {
      ({ houseId, trustId } = await houseAndTrust(ctx.tx));
      const line = changeLine(
        "liability",
        {
          ...loanFields("Lake House mortgage"),
          liabilityType: "mortgage",
          owners: [{ who: { ref: "line", target: "entity", lineId: "L-trust" }, percent: 1 }],
          linkedPropertyId: { ref: "line", target: "account", lineId: "L-house" },
        },
        { dependsOn: ["L-house", "L-trust"] },
      );
      id = await writer.create(ctx, inputOf(line, { ...ids(), "line:L-house": houseId, "line:L-trust": trustId }));
    });
    const row = await liabilityRow(id);
    expect(row.linkedPropertyId).toBe(houseId);
    expect(row.liabilityType).toBe("mortgage");
    const owners = await ownerRows(id);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ entityId: trustId, familyMemberId: null });
    expect(Number(owners[0].percent)).toBe(1);
    // The audit snapshot read the house on the same transaction — not "(deleted)".
    const [audit] = await auditOf(id, "liability.create");
    expect(JSON.stringify(audit.metadata)).toContain("Lake House");
    expect(JSON.stringify(audit.metadata)).not.toContain("(deleted)");
  });

  it("(c) an update that moves a loan onto a house and a trust created earlier in the save", async () => {
    let loanId = "";
    await inSave(scope, async (ctx) => {
      loanId = await writer.create(ctx, inputOf(changeLine("liability", loanFields("Moved loan")), ids()));
    });
    let houseId = "";
    let trustId = "";
    await inSave(scope, async (ctx) => {
      ({ houseId, trustId } = await houseAndTrust(ctx.tx));
      const line = changeLine(
        "liability",
        {
          owners: [{ who: { ref: "line", target: "entity", lineId: "L-trust" }, percent: 1 }],
          linkedPropertyId: { ref: "line", target: "account", lineId: "L-house" },
        },
        { recordId: loanId },
      );
      await writer.update(ctx, inputOf(line, { ...ids(), "line:L-house": houseId, "line:L-trust": trustId }));
    });
    expect((await liabilityRow(loanId)).linkedPropertyId).toBe(houseId);
    expect((await ownerRows(loanId)).map((o) => o.entityId)).toEqual([trustId]);
    // The update's after-snapshot read the house on the same transaction — not "(deleted)".
    const [audit] = await auditOf(loanId, "liability.update");
    expect(JSON.stringify(audit.metadata)).toContain("Lake House");
    expect(JSON.stringify(audit.metadata)).not.toContain("(deleted)");
  });

  it("(c) a joint loan owned with the co-client a household line added earlier in the save", async () => {
    const single = await seedSaveClient(FIRM);
    const { result } = await inSave(
      { clientId: single.clientId, firmId: FIRM },
      async (ctx) => {
        // As the household writer leaves it: the co-client's family member, on the transaction.
        const [laura] = await ctx.tx
          .insert(familyMembers)
          .values({ clientId: single.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other", dateOfBirth: "1970-09-30" })
          .returning({ id: familyMembers.id });
        const line = changeLine("liability", { ...loanFields("Joint HELOC"), owners: [...jointOwners] });
        const id = await writer.create(ctx, inputOf(line, { "person:client": single.clientMemberId, "person:spouse": laura.id }));
        const owners = await ctx.tx.select().from(liabilityOwners).where(eq(liabilityOwners.liabilityId, id));
        return { laura: laura.id, owners: owners.map((o) => [o.familyMemberId, Number(o.percent)]) };
      },
      { rollback: true },
    );
    expect(result.owners).toEqual(expect.arrayContaining([[single.clientMemberId, 0.5], [result.laura, 0.5]]));
    expect(result.owners).toHaveLength(2);
  });

  it("(c) the same mortgage in a save that rolls back leaves neither the house, the trust nor the loan", async () => {
    let houseId = "";
    let trustId = "";
    let id = "";
    await inSave(
      scope,
      async (ctx) => {
        ({ houseId, trustId } = await houseAndTrust(ctx.tx));
        const line = changeLine("liability", {
          ...loanFields("Ghost mortgage"),
          owners: [{ who: { ref: "line", target: "entity", lineId: "L-trust" }, percent: 1 }],
          linkedPropertyId: { ref: "line", target: "account", lineId: "L-house" },
        });
        id = await writer.create(ctx, inputOf(line, { ...ids(), "line:L-house": houseId, "line:L-trust": trustId }));
      },
      { rollback: true },
    );
    expect(await liabilityRow(id)).toBeUndefined();
    expect(await db.select().from(accounts).where(eq(accounts.id, houseId))).toHaveLength(0);
    expect(await db.select().from(entities).where(eq(entities.id, trustId))).toHaveLength(0);
  });

  it("(c) a property that isn't this client's is refused, naming the reason", async () => {
    const other = await seedSaveClient(FIRM);
    const [foreign] = await db
      .insert(accounts)
      .values({ clientId: other.clientId, scenarioId: other.scenarioId, name: "Not theirs", category: "real_estate", subType: "primary_residence" })
      .returning({ id: accounts.id });
    const line = changeLine("liability", { ...loanFields("Wrong house"), linkedPropertyId: { ref: "record", target: "account", id: foreign.id } });
    await expect(inSave(scope, (ctx) => writer.create(ctx, inputOf(line, ids())))).rejects.toThrow(SaveLineError);
    await expect(inSave(scope, (ctx) => writer.create(ctx, inputOf(line, ids())))).rejects.toThrow(/not owned by this client/);
  });

  it("(d) the debt type is written only when the line carries it; the owners are the line's", async () => {
    let plain = "";
    let joint = "";
    await inSave(scope, async (ctx) => {
      const { liabilityType: _skip, ...noType } = loanFields("Untyped loan");
      void _skip;
      plain = await writer.create(ctx, inputOf(changeLine("liability", noType), ids()));
      joint = await writer.create(ctx, inputOf(changeLine("liability", { ...loanFields("Joint loan"), owners: [...jointOwners] }), ids()));
    });
    expect((await liabilityRow(plain)).liabilityType).toBeNull();
    // No owners on the line: the Details default, the client alone.
    expect((await ownerRows(plain)).map((o) => [o.familyMemberId, Number(o.percent)])).toEqual([[seed.clientMemberId, 1]]);
    // Owners on the line: exactly those — never "the client alone".
    const owners = await ownerRows(joint);
    expect(owners.map((o) => o.familyMemberId).sort()).toEqual([seed.clientMemberId, seed.spouseMemberId!].sort());
    expect(owners.map((o) => Number(o.percent))).toEqual([0.5, 0.5]);

    // An update that doesn't carry the type or owners leaves both as they are.
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(changeLine("liability", { interestRate: 0.05 }, { recordId: joint }), ids())));
    const after = await liabilityRow(joint);
    expect(after.liabilityType).toBe("auto");
    expect(Number(after.interestRate)).toBeCloseTo(0.05, 4);
    expect(await ownerRows(joint)).toHaveLength(2);
  });

  it("(d) an update that changes the owners replaces them with the line's", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      id = await writer.create(ctx, inputOf(changeLine("liability", { ...loanFields("Re-owned loan"), owners: [...jointOwners] }), ids()));
    });
    const line = changeLine("liability", { owners: [{ who: { ref: "person", role: "spouse" }, percent: 1 }] }, { recordId: id });
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(line, ids())));
    expect((await ownerRows(id)).map((o) => [o.familyMemberId, Number(o.percent)])).toEqual([[seed.spouseMemberId, 1]]);
  });

  it("a loan type the plan can't save is refused before the loan is written or changed", async () => {
    const { result } = await inSave(
      scope,
      async (ctx) => {
        const auditRows = () => ctx.tx.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.clientId, seed.clientId));
        const before = (await auditRows()).length;
        const onRecord = await writer.create(ctx, inputOf(changeLine("liability", loanFields("Typed loan")), ids()));
        const afterCreate = (await auditRows()).length;
        const create = await writer.create(ctx, inputOf(changeLine("liability", { ...loanFields("Boat loan"), liabilityType: "boat" }), ids())).catch((e: unknown) => e);
        const update = await writer.update(ctx, inputOf(changeLine("liability", { balance: 1, liabilityType: "boat" }, { recordId: onRecord }), ids())).catch((e: unknown) => e);
        const boat = await ctx.tx.select().from(liabilities).where(and(eq(liabilities.clientId, seed.clientId), eq(liabilities.name, "Boat loan")));
        const [typed] = await ctx.tx.select().from(liabilities).where(eq(liabilities.id, onRecord));
        return { create, update, boat, balance: Number(typed.balance), audits: [before, afterCreate, (await auditRows()).length] };
      },
      { rollback: true },
    );
    for (const refused of [result.create, result.update]) {
      expect(refused).toBeInstanceOf(SaveLineError);
      expect(refused).toMatchObject({ message: "The loan type isn't one the plan can save." });
    }
    expect(result.boat).toEqual([]);
    expect(result.balance).toBe(18500);
    // Only the typed loan's own audit row: neither refused line reached the write path.
    expect(result.audits[2]).toBe(result.audits[1]);
    expect(result.audits[1]).toBe(result.audits[0] + 1);
  });

  it("an update with no record is refused", async () => {
    const line = changeLine("liability", { balance: 5 });
    await expect(inSave(scope, (ctx) => writer.update(ctx, { ...inputOf(line, ids()), recordId: null }))).rejects.toThrow(SaveLineError);
  });

  it("(e) a liability save queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) => writer.create(ctx, inputOf(changeLine("liability", loanFields("Queue check")), ids())));
    expect(saved.queued).toBe(0);
  });
});
