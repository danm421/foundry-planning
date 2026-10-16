// src/lib/fact-finder/save/__tests__/writers-people-notes.test.ts
//
// The charity, related-party and plan-note save writers on a real transaction
// (live dev database): the Details write paths' rows and audit rows commit or
// roll back with the save, notes made in one save get increasing sort orders,
// a related party lands on the client's own household, and a charity the plan
// already has by that name — or one the same save just added — is refused.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, crmHouseholdContacts, externalBeneficiaries, planObservations } from "@/db/schema";
import { PEOPLE_NOTE_WRITERS } from "../writers/people-notes";
import { SaveLineError } from "../types";
import { changeLine, dropSaveFirm, inputOf, inSave, seedSaveClient, type SaveSeed } from "./harness";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_people", orgRole: "org:admin" }),
}));

const FIRM = "firm_test_ff_save_people";
const charity = PEOPLE_NOTE_WRITERS.external_beneficiary;
const party = PEOPLE_NOTE_WRITERS.related_party;
const note = PEOPLE_NOTE_WRITERS.plan_observation;
let seed: SaveSeed;
let scope: { clientId: string; firmId: string };

beforeAll(async () => {
  await dropSaveFirm(FIRM);
  seed = await seedSaveClient(FIRM);
  scope = { clientId: seed.clientId, firmId: FIRM };
});
afterAll(() => dropSaveFirm(FIRM));

const charityRow = async (id: string) => (await db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.id, id)))[0];
const contactRow = async (id: string) => (await db.select().from(crmHouseholdContacts).where(eq(crmHouseholdContacts.id, id)))[0];
const noteRow = async (id: string) => (await db.select().from(planObservations).where(eq(planObservations.id, id)))[0];
const auditOf = (id: string, action?: string) =>
  db.select().from(auditLog).where(action ? and(eq(auditLog.resourceId, id), eq(auditLog.action, action)) : eq(auditLog.resourceId, id));
const noteLine = (body: string, opts: Parameters<typeof changeLine>[2] = {}) =>
  changeLine("plan_observation", { topic: "estate", body }, { fixed: { section: "observation", audience: "advisor", source: "manual" }, ...opts });
const attorneyLine = (opts: Parameters<typeof changeLine>[2] = {}) =>
  changeLine(
    "related_party",
    { firstName: "Jane", lastName: "Smith", employer: "Smith & Co" },
    { fixed: { relationshipLabel: "Estate attorney" }, ...opts },
  );

describe("charity save writer", () => {
  it("(a) create and update commit; the charity keeps its kind on a note-only update; no audit row (Details writes none)", async () => {
    const create = changeLine("external_beneficiary", { name: "Red Cross", kind: "charity", charityType: "public", notes: "Annual gift" });
    const { result: id } = await inSave(scope, (ctx) => charity.create(ctx, inputOf(create)));
    expect(await charityRow(id)).toMatchObject({ clientId: seed.clientId, name: "Red Cross", kind: "charity", charityType: "public", notes: "Annual gift" });

    await inSave(scope, (ctx) => charity.update(ctx, inputOf(changeLine("external_beneficiary", { notes: "Quarterly gift" }, { recordId: id }))));
    expect(await charityRow(id)).toMatchObject({ name: "Red Cross", kind: "charity", charityType: "public", notes: "Quarterly gift" });
    expect(await auditOf(id)).toHaveLength(0);
  });

  it("(b) a save that then throws leaves no charity", async () => {
    const { result: id } = await inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Rolled back" }))), { rollback: true });
    expect(await charityRow(id)).toBeUndefined();
  });

  it("(d) a charity the plan already has by that name is refused — trimmed, any case", async () => {
    const dup = changeLine("external_beneficiary", { name: "  red cross " });
    const refused = inSave(scope, (ctx) => charity.create(ctx, inputOf(dup)));
    await expect(refused).rejects.toThrow(SaveLineError);
    await expect(inSave(scope, (ctx) => charity.create(ctx, inputOf(dup)))).rejects.toThrow(
      "The plan already has a charity named “red cross” — link this row to it, or untick it.",
    );
    const rows = await db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, seed.clientId));
    expect(rows.filter((r) => r.name === "Red Cross")).toHaveLength(1);
  });

  it("(d) two charities of one name added in one save — any case — are refused as two new rows, not as one on the plan", async () => {
    const twice = () =>
      inSave(scope, async (ctx) => {
        await charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Habitat" })));
        await charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: " HABITAT " })));
      });
    await expect(twice()).rejects.toThrow(SaveLineError);
    await expect(twice()).rejects.toThrow("Two charities named “HABITAT” are being added — merge the rows, or untick one.");
    const rows = await db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, seed.clientId));
    expect(rows.filter((r) => r.name.toLowerCase().trim() === "habitat")).toHaveLength(0);

    // A charity on record before the save keeps its own message, even beside a new one made earlier in the save.
    await expect(
      inSave(scope, async (ctx) => {
        await charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Habitat" })));
        await charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Red cross" })));
      }),
    ).rejects.toThrow("The plan already has a charity named “Red cross” — link this row to it, or untick it.");
  });

  it("(d) a person, not a charity: a new individual beneficiary's duplicate is refused as a beneficiary", async () => {
    const jane = (name: string) => changeLine("external_beneficiary", { name, kind: "individual" });
    await inSave(scope, (ctx) => charity.create(ctx, inputOf(jane("Jane Doe"))));
    await expect(inSave(scope, (ctx) => charity.create(ctx, inputOf(jane("jane doe"))))).rejects.toThrow(
      "The plan already has a beneficiary named “jane doe” — link this row to it, or untick it.",
    );
    await expect(
      inSave(scope, async (ctx) => {
        await charity.create(ctx, inputOf(jane("John Roe")));
        await charity.create(ctx, inputOf(jane("John Roe")));
      }),
    ).rejects.toThrow("Two beneficiaries named “John Roe” are being added — merge the rows, or untick one.");
    const rows = await db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, seed.clientId));
    expect(rows.filter((r) => r.name.toLowerCase() === "jane doe").map((r) => r.kind)).toEqual(["individual"]);
    expect(rows.filter((r) => r.name === "John Roe")).toHaveLength(0);
  });

  it("(d) the refusal names the record on file by its own kind, not the new row's", async () => {
    await inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Pat Lee", kind: "individual" }))));
    await inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Food Bank", kind: "charity" }))));
    await expect(
      inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "pat lee", kind: "charity" })))),
    ).rejects.toThrow("The plan already has a beneficiary named “pat lee” — link this row to it, or untick it.");
    await expect(
      inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "food bank", kind: "individual" })))),
    ).rejects.toThrow("The plan already has a charity named “food bank” — link this row to it, or untick it.");
    // Two new rows in one save keep the second row's own noun.
    await expect(
      inSave(scope, async (ctx) => {
        await charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Sam Poe", kind: "charity" })));
        await charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Sam Poe", kind: "individual" })));
      }),
    ).rejects.toThrow("Two beneficiaries named “Sam Poe” are being added — merge the rows, or untick one.");
  });

  it("(d) an Update renaming a charity is not a duplicate check", async () => {
    const { result: id } = await inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Scouts" }))));
    await inSave(scope, (ctx) => charity.update(ctx, inputOf(changeLine("external_beneficiary", { name: "Boy Scouts" }, { recordId: id }))));
    expect((await charityRow(id)).name).toBe("Boy Scouts");
  });

  it("an update with no record, or a record that isn't this client's, is refused", async () => {
    const line = changeLine("external_beneficiary", { notes: "x" });
    await expect(inSave(scope, (ctx) => charity.update(ctx, { ...inputOf(line), recordId: null }))).rejects.toThrow(SaveLineError);
    const other = await seedSaveClient(FIRM);
    const [foreign] = await db.insert(externalBeneficiaries).values({ clientId: other.clientId, name: "Not ours" }).returning({ id: externalBeneficiaries.id });
    await expect(inSave(scope, (ctx) => charity.update(ctx, inputOf(changeLine("external_beneficiary", { notes: "x" }, { recordId: foreign.id }))))).rejects.toThrow("Not found");
    expect((await charityRow(foreign.id)).notes).toBeNull();
  });

  it("(e) queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) => charity.create(ctx, inputOf(changeLine("external_beneficiary", { name: "Queue check" }))));
    expect(saved.queued).toBe(0);
  });
});

describe("related party save writer", () => {
  it("(a)(c) create lands on the client's own household as role other, with its audit row; update changes only what the line carries", async () => {
    const { result: id } = await inSave(scope, (ctx) => party.create(ctx, inputOf(attorneyLine())));
    expect(await contactRow(id)).toMatchObject({
      householdId: seed.householdId, role: "other", firstName: "Jane", lastName: "Smith", employer: "Smith & Co", relationshipLabel: "Estate attorney", familyMemberId: null,
    });
    expect(await auditOf(id, "related_party.create")).toHaveLength(1);

    await inSave(scope, (ctx) => party.update(ctx, inputOf(changeLine("related_party", { employer: "Smith LLP" }, { recordId: id }))));
    expect(await contactRow(id)).toMatchObject({ firstName: "Jane", lastName: "Smith", employer: "Smith LLP", relationshipLabel: "Estate attorney" });
    expect(await auditOf(id, "related_party.update")).toHaveLength(1);
  });

  it("(b) a save that then throws leaves no contact and no audit row", async () => {
    const { result: id } = await inSave(
      scope,
      async (ctx) => {
        const made = await party.create(ctx, inputOf(attorneyLine()));
        await party.update(ctx, inputOf(changeLine("related_party", { employer: "Gone" }, { recordId: made })));
        return made;
      },
      { rollback: true },
    );
    expect(await contactRow(id)).toBeUndefined();
    expect(await auditOf(id)).toHaveLength(0);
  });

  it("(d) the household's own contacts and another household's contacts are not editable here", async () => {
    const [primary] = await db.select().from(crmHouseholdContacts).where(and(eq(crmHouseholdContacts.householdId, seed.householdId), eq(crmHouseholdContacts.role, "primary")));
    const line = changeLine("related_party", { employer: "Hacked" }, { recordId: primary.id });
    await expect(inSave(scope, (ctx) => party.update(ctx, inputOf(line)))).rejects.toThrow(/Related party not found/);
    const other = await seedSaveClient(FIRM);
    const [foreign] = await db.insert(crmHouseholdContacts).values({ householdId: other.householdId, role: "other", firstName: "Zed", lastName: "Other" }).returning({ id: crmHouseholdContacts.id });
    await expect(inSave(scope, (ctx) => party.update(ctx, inputOf(changeLine("related_party", { employer: "Hacked" }, { recordId: foreign.id }))))).rejects.toThrow(SaveLineError);
    expect((await contactRow(primary.id)).employer).toBeNull();
    expect((await contactRow(foreign.id)).employer).toBeNull();
  });

  it("a create with no last name is refused with the route's message", async () => {
    const line = changeLine("related_party", { firstName: "Jane" });
    await expect(inSave(scope, (ctx) => party.create(ctx, inputOf(line)))).rejects.toThrow("lastName: Last name is required");
  });

  it("(e) queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) => party.create(ctx, inputOf(attorneyLine())));
    expect(saved.queued).toBe(0);
  });
});

describe("plan note save writer", () => {
  it("(a) create and update commit with their audit rows; an update leaves the section, source and status alone", async () => {
    const { result: id } = await inSave(scope, (ctx) => note.create(ctx, inputOf(noteLine("Will last updated 2019."))));
    expect(await noteRow(id)).toMatchObject({ clientId: seed.clientId, section: "observation", audience: "advisor", source: "manual", topic: "estate", body: "Will last updated 2019.", status: "open" });
    expect(await auditOf(id, "plan_observation.create")).toHaveLength(1);

    await inSave(scope, (ctx) => note.update(ctx, inputOf(changeLine("plan_observation", { body: "Will last updated 2021." }, { recordId: id }))));
    expect(await noteRow(id)).toMatchObject({ section: "observation", audience: "advisor", topic: "estate", body: "Will last updated 2021.", status: "open" });
    expect(await auditOf(id, "plan_observation.update")).toHaveLength(1);
  });

  it("(b) a save that then throws leaves no note and no audit row", async () => {
    const { result: id } = await inSave(scope, (ctx) => note.create(ctx, inputOf(noteLine("Rolled back note."))), { rollback: true });
    expect(await noteRow(id)).toBeUndefined();
    expect(await auditOf(id)).toHaveLength(0);
  });

  it("(c) three notes made in one save get increasing sort orders after the ones on record", async () => {
    const { result: before } = await inSave(scope, (ctx) => note.create(ctx, inputOf(noteLine("Existing note."))));
    const start = (await noteRow(before)).sortOrder;
    const { result: ids } = await inSave(scope, async (ctx) => [
      await note.create(ctx, inputOf(noteLine("Note A."))),
      await note.create(ctx, inputOf(noteLine("Note B."))),
      await note.create(ctx, inputOf(noteLine("Note C."))),
    ]);
    const orders = await Promise.all(ids.map(async (id) => (await noteRow(id)).sortOrder));
    expect(orders).toEqual([start + 1, start + 2, start + 3]);
  });

  it("(d) a note with a body over the limit, or an update with no record, is refused", async () => {
    await expect(inSave(scope, (ctx) => note.create(ctx, inputOf(noteLine("x".repeat(8001)))))).rejects.toThrow(SaveLineError);
    const line = changeLine("plan_observation", { body: "Y" });
    await expect(inSave(scope, (ctx) => note.update(ctx, { ...inputOf(line), recordId: null }))).rejects.toThrow(SaveLineError);
  });

  it("(e) queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) => note.create(ctx, inputOf(noteLine("Queue check."))));
    expect(saved.queued).toBe(0);
  });
});
