// src/lib/fact-finder/save/__tests__/writers-notes-receivable.test.ts
//
// The note-receivable save writer on a real transaction (live dev database): the
// Details write path's rows and audit rows commit or roll back with the save, a
// note can belong to a trust, a family member and a charity created earlier in
// the same save, and the core still answers exactly as the routes did.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, entities, externalBeneficiaries, familyMembers, noteReceivableOwners, notesReceivable } from "@/db/schema";
import { createNoteReceivableForClient, noteCreateRefusal, noteUpdateRefusal, updateNoteReceivableForClient } from "@/lib/clients/notes-receivable-writes";
import { NOTE_WRITERS } from "../writers/notes-receivable";
import { SaveLineError } from "../types";
import { changeLine, dropSaveFirm, inputOf, inSave, SAVE_ACTOR, seedSaveClient, type SaveSeed } from "./harness";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_notes", orgRole: "org:admin" }),
}));

const FIRM = "firm_test_ff_save_notes";
const writer = NOTE_WRITERS.note_receivable;
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

const noteFields = (name: string) => ({
  name,
  faceValue: 120000,
  basis: 120000,
  asOfBalance: 96000,
  balanceAsOf: "2025-06",
  interestRate: 0.05,
  paymentType: "amortizing",
  monthlyPayment: 1450,
  start: "2023-02",
  termMonths: 120,
});

const noteRow = async (id: string) => (await db.select().from(notesReceivable).where(eq(notesReceivable.id, id)))[0];
const ownerRows = (id: string) => db.select().from(noteReceivableOwners).where(eq(noteReceivableOwners.noteReceivableId, id));
const auditOf = (id: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.resourceId, id), eq(auditLog.action, action)));

type Tx = Parameters<Parameters<typeof inSave>[1]>[0]["tx"];
/** What Tasks 7's neighbours (11 trusts, 5 family members, 12 charities) will write: inserted on the save's own transaction. */
async function peopleAndTrust(tx: Tx) {
  const [trust] = await tx.insert(entities).values({ clientId: seed.clientId, name: "Hendricks Family Trust", entityType: "trust" }).returning({ id: entities.id });
  const [child] = await tx.insert(familyMembers).values({ clientId: seed.clientId, firstName: "Ava", relationship: "child", role: "child" }).returning({ id: familyMembers.id });
  const [charity] = await tx.insert(externalBeneficiaries).values({ clientId: seed.clientId, name: "Mesa Food Bank", kind: "charity" }).returning({ id: externalBeneficiaries.id });
  return { trustId: trust.id, childId: child.id, charityId: charity.id };
}

describe("note receivable save writer", () => {
  it("(a) create and update commit: the note, its owners and both audit rows are there", async () => {
    let id = "";
    const saved = await inSave(scope, async (ctx) => {
      id = await writer.create(ctx, inputOf(changeLine("note_receivable", { ...noteFields("Dana Whitfield"), owners: [...jointOwners] }), ids()));
      return id;
    });
    expect(saved.result).toBe(id);
    const row = await noteRow(id);
    expect(row).toMatchObject({ name: "Dana Whitfield", paymentType: "amortizing", balanceAsOfMonth: 6, balanceAsOfYear: 2025, startMonth: 2, startYear: 2023, termMonths: 120 });
    expect(Number(row.faceValue)).toBe(120000);
    expect(Number(row.basis)).toBe(120000);
    expect(Number(row.interestRate)).toBeCloseTo(0.05, 4);
    expect(row.scenarioId).toBe(seed.scenarioId);
    const owners = await ownerRows(id);
    expect(owners.map((o) => o.familyMemberId).sort()).toEqual([seed.clientMemberId, seed.spouseMemberId!].sort());
    expect(await auditOf(id, "note_receivable.create")).toHaveLength(1);

    // Update: only the name and the balance are on the line.
    const update = changeLine("note_receivable", { name: "Dana Whitfield-Cole", asOfBalance: 90000 }, { recordId: id });
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(update, ids())));
    const after = await noteRow(id);
    expect(after.name).toBe("Dana Whitfield-Cole");
    expect(Number(after.asOfBalance)).toBe(90000);
    expect(Number(after.monthlyPayment)).toBe(1450);
    expect(after.balanceAsOfYear).toBe(2025);
    expect(await ownerRows(id)).toHaveLength(2);
    expect(await auditOf(id, "note_receivable.update")).toHaveLength(1);
  });

  it("(b) a save that then throws leaves no note, no owner row and no audit row", async () => {
    let id = "";
    await inSave(
      scope,
      async (ctx) => {
        id = await writer.create(ctx, inputOf(changeLine("note_receivable", { ...noteFields("Rolled-back note"), owners: [...jointOwners] }), ids()));
        await writer.update(ctx, inputOf(changeLine("note_receivable", { asOfBalance: 1 }, { recordId: id }), ids()));
      },
      { rollback: true },
    );
    expect(id).not.toBe("");
    expect(await noteRow(id)).toBeUndefined();
    expect(await ownerRows(id)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.resourceId, id))).toHaveLength(0);
  });

  it("(c) a note owned by a trust, a family member and a charity, all created earlier in the save", async () => {
    let id = "";
    let made = { trustId: "", childId: "", charityId: "" };
    await inSave(scope, async (ctx) => {
      made = await peopleAndTrust(ctx.tx);
      const line = changeLine(
        "note_receivable",
        {
          ...noteFields("Family note"),
          owners: [
            { who: { ref: "line", target: "entity", lineId: "L-trust" }, percent: 0.5 },
            { who: { ref: "line", target: "family_member", lineId: "L-child" }, percent: 0.3 },
            { who: { ref: "line", target: "external_beneficiary", lineId: "L-charity" }, percent: 0.2 },
          ],
        },
        { dependsOn: ["L-trust", "L-child", "L-charity"] },
      );
      id = await writer.create(ctx, inputOf(line, { ...ids(), "line:L-trust": made.trustId, "line:L-child": made.childId, "line:L-charity": made.charityId }));
    });
    const owners = await ownerRows(id);
    expect(owners).toHaveLength(3);
    expect(owners.find((o) => o.entityId === made.trustId)).toMatchObject({ familyMemberId: null, externalBeneficiaryId: null });
    expect(owners.find((o) => o.familyMemberId === made.childId)).toMatchObject({ entityId: null, externalBeneficiaryId: null });
    expect(owners.find((o) => o.externalBeneficiaryId === made.charityId)).toMatchObject({ entityId: null, familyMemberId: null });
    expect(owners.map((o) => Number(o.percent)).sort()).toEqual([0.2, 0.3, 0.5]);
  });

  it("(c) an update that hands a note to a trust created earlier in the save", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      id = await writer.create(ctx, inputOf(changeLine("note_receivable", { ...noteFields("Moved note"), owners: [...jointOwners] }), ids()));
    });
    let trustId = "";
    await inSave(scope, async (ctx) => {
      ({ trustId } = await peopleAndTrust(ctx.tx));
      const line = changeLine("note_receivable", { owners: [{ who: { ref: "line", target: "entity", lineId: "L-trust" }, percent: 1 }] }, { recordId: id });
      await writer.update(ctx, inputOf(line, { ...ids(), "line:L-trust": trustId }));
    });
    expect((await ownerRows(id)).map((o) => [o.entityId, Number(o.percent)])).toEqual([[trustId, 1]]);
  });

  it("(c) the same note in a save that rolls back leaves neither the trust, the child, the charity nor the note", async () => {
    let id = "";
    let made = { trustId: "", childId: "", charityId: "" };
    await inSave(
      scope,
      async (ctx) => {
        made = await peopleAndTrust(ctx.tx);
        const line = changeLine("note_receivable", {
          ...noteFields("Ghost note"),
          owners: [{ who: { ref: "line", target: "entity", lineId: "L-trust" }, percent: 1 }],
        });
        id = await writer.create(ctx, inputOf(line, { ...ids(), "line:L-trust": made.trustId }));
      },
      { rollback: true },
    );
    expect(await noteRow(id)).toBeUndefined();
    expect(await db.select().from(entities).where(eq(entities.id, made.trustId))).toHaveLength(0);
    expect(await db.select().from(familyMembers).where(eq(familyMembers.id, made.childId))).toHaveLength(0);
    expect(await db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.id, made.charityId))).toHaveLength(0);
  });

  it("(c) the linked trust is checked and labelled on the save's transaction", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      const { trustId } = await peopleAndTrust(ctx.tx);
      const result = await createNoteReceivableForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, tx: ctx.tx, afterCommit: ctx.afterCommit,
        input: {
          name: "Sale note", faceValue: 50000, basis: 10000, interestRate: 0.04, paymentType: "amortizing", startYear: 2026, termMonths: 60,
          linkedTrustEntityId: trustId, owners: [{ familyMemberId: seed.clientMemberId, percent: 1 }],
        },
      });
      if (!result.ok) throw new Error(result.error);
      id = result.resourceId;
    });
    expect((await noteRow(id)).linkedTrustEntityId).not.toBeNull();
    const [audit] = await auditOf(id, "note_receivable.create");
    expect(JSON.stringify(audit.metadata)).toContain("Hendricks Family Trust");
    expect(JSON.stringify(audit.metadata)).not.toContain("(deleted)");
  });

  it("(c) an owner that isn't this client's is refused with the Details message", async () => {
    const other = await seedSaveClient(FIRM);
    const line = changeLine("note_receivable", {
      ...noteFields("Wrong owner"),
      owners: [{ who: { ref: "record", target: "family_member", id: other.clientMemberId }, percent: 1 }],
    });
    await expect(inSave(scope, (ctx) => writer.create(ctx, inputOf(line, ids())))).rejects.toThrow(SaveLineError);
    await expect(inSave(scope, (ctx) => writer.create(ctx, inputOf(line, ids())))).rejects.toThrow("Family member owner not found for this client");
  });

  it("(d) owners that don't add up to 100% are refused; an update without owners keeps them; with owners replaces them", async () => {
    const short = changeLine("note_receivable", { ...noteFields("Short note"), owners: [{ who: { ref: "person", role: "client" }, percent: 0.6 }] });
    await expect(inSave(scope, (ctx) => writer.create(ctx, inputOf(short, ids())))).rejects.toThrow("Owner percents must sum to 1 (100%)");

    let id = "";
    await inSave(scope, async (ctx) => {
      id = await writer.create(ctx, inputOf(changeLine("note_receivable", { ...noteFields("Owned note"), owners: [...jointOwners] }), ids()));
    });
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(changeLine("note_receivable", { interestRate: 0.06 }, { recordId: id }), ids())));
    expect(await ownerRows(id)).toHaveLength(2);
    expect(Number((await noteRow(id)).interestRate)).toBeCloseTo(0.06, 4);

    const solo = changeLine("note_receivable", { owners: [{ who: { ref: "person", role: "spouse" }, percent: 1 }] }, { recordId: id });
    await inSave(scope, (ctx) => writer.update(ctx, inputOf(solo, ids())));
    expect((await ownerRows(id)).map((o) => [o.familyMemberId, Number(o.percent)])).toEqual([[seed.spouseMemberId, 1]]);
  });

  it("an update with no record is refused", async () => {
    const line = changeLine("note_receivable", { asOfBalance: 5 });
    await expect(inSave(scope, (ctx) => writer.update(ctx, { ...inputOf(line, ids()), recordId: null }))).rejects.toThrow(SaveLineError);
  });

  it("(e) a note receivable save queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) => writer.create(ctx, inputOf(changeLine("note_receivable", { ...noteFields("Queue check"), owners: [...jointOwners] }), ids())));
    expect(saved.queued).toBe(0);
  });

  it("the core answers as the routes did, with no transaction of its own to join", async () => {
    const args = { clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR };
    // Bad input: the route's { error: "Invalid input", details } body rides along.
    const bad = await createNoteReceivableForClient({ ...args, input: { name: "" } });
    expect(bad).toMatchObject({ ok: false, status: 400, body: { error: "Invalid input", details: { fieldErrors: expect.any(Object) } } });
    // Another firm's id: "Client not found".
    expect(await createNoteReceivableForClient({ ...args, firmId: "firm_other", input: {} })).toMatchObject({ ok: false, status: 404, error: "Client not found" });
    // A note that isn't there.
    expect(
      await updateNoteReceivableForClient({ ...args, noteId: "00000000-0000-4000-8000-000000000000", input: { name: "x" } }),
    ).toMatchObject({ ok: false, status: 404, error: "Note not found" });
    // The routes ask these two first, before they read the body.
    expect(await noteCreateRefusal(seed.clientId, FIRM)).toBeNull();
    expect(await noteCreateRefusal(seed.clientId, "firm_other")).toMatchObject({ status: 404, error: "Client not found" });
    expect(await noteUpdateRefusal(seed.clientId, "00000000-0000-4000-8000-000000000000")).toMatchObject({ status: 404, error: "Note not found" });
    // A good create and update with no tx commit on their own, audit rows included.
    const created = await createNoteReceivableForClient({
      ...args,
      input: { ...{ name: "Plain note", faceValue: 1000, basis: 1000, interestRate: 0.03, paymentType: "amortizing", startYear: 2026, termMonths: 12 }, owners: [{ familyMemberId: seed.clientMemberId, percent: 1 }] },
    });
    if (!created.ok) throw new Error(created.error);
    expect(await auditOf(created.resourceId, "note_receivable.create")).toHaveLength(1);
    const updated = await updateNoteReceivableForClient({ ...args, noteId: created.resourceId, input: { name: "Plain note 2" } });
    expect(updated).toMatchObject({ ok: true, data: { name: "Plain note 2" } });
    expect(await auditOf(created.resourceId, "note_receivable.update")).toHaveLength(1);
  });
});
