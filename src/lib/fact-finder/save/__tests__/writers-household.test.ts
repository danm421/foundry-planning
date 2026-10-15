// src/lib/fact-finder/save/__tests__/writers-household.test.ts
//
// Live dev database: the household's save writers (Plan 4, Task 5) — the
// profile, the tax settings and family members, each through its Details core
// on the save's transaction, plus each person's employer, which the profile
// update doesn't write. Bodies come from payloadFor over change lines built as
// the review builds them. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_household", orgRole: "org:admin" }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clients, crmHouseholdContacts, familyMembers, planSettings, scenarios } from "@/db/schema";
import type { DbOrTx } from "@/lib/db-tx";
import type { PlacedValue } from "../../change-set";
import { SaveLineError } from "../types";
import { HOUSEHOLD_WRITERS } from "../writers/household";
import { changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_household";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const W = HOUSEHOLD_WRITERS;
const rollback = { rollback: true };
const at = (seed: SaveSeed) => ({ clientId: seed.clientId, firmId: FIRM });

/** A Household-page or Salary row's line: always an update of the household record (the client). */
const household = (seed: SaveSeed, fields: Record<string, PlacedValue>, label = "Household") =>
  changeLine("client_household", fields, { recordId: seed.clientId, label });

async function actions(clientId: string, handle: DbOrTx = db) {
  const rows = await handle.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.clientId, clientId));
  return rows.map((r) => r.action).sort();
}

async function contactOf(seed: SaveSeed, role: "primary" | "spouse", handle: DbOrTx = db) {
  const [row] = await handle
    .select({ firstName: crmHouseholdContacts.firstName, dateOfBirth: crmHouseholdContacts.dateOfBirth, city: crmHouseholdContacts.city, employer: crmHouseholdContacts.employer })
    .from(crmHouseholdContacts)
    .where(and(eq(crmHouseholdContacts.householdId, seed.householdId), eq(crmHouseholdContacts.role, role)));
  return row ?? null;
}

async function householdMembers(clientId: string, handle: DbOrTx = db) {
  const rows = await handle
    .select({ role: familyMembers.role, firstName: familyMembers.firstName, dateOfBirth: familyMembers.dateOfBirth })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId));
  return rows.filter((r) => r.role === "client" || r.role === "spouse").sort((a, b) => a.role.localeCompare(b.role));
}

async function clientRow(clientId: string, handle: DbOrTx = db) {
  const [row] = await handle.select().from(clients).where(eq(clients.id, clientId));
  return row;
}

async function planEndYears(clientId: string, handle: DbOrTx = db) {
  const rows = await handle.select({ planEndYear: planSettings.planEndYear }).from(planSettings).where(eq(planSettings.clientId, clientId));
  return rows.map((r) => r.planEndYear);
}

/** The base case's settings row (the record a tax settings line updates). */
async function baseSettings(clientId: string) {
  const [row] = await db
    .select({ id: planSettings.id, residenceState: planSettings.residenceState })
    .from(planSettings)
    .innerJoin(scenarios, eq(scenarios.id, planSettings.scenarioId))
    .where(and(eq(planSettings.clientId, clientId), eq(scenarios.isBaseCase, true)));
  return row;
}

d("household save writers", () => {
  beforeAll(() => dropSaveFirm(FIRM));
  afterAll(() => dropSaveFirm(FIRM));

  describe("the household (client_household)", () => {
    it("adds a co-client on the transaction — contact, family member, plan end — for the lines after it; they roll back with it", async () => {
      const seed = await seedSaveClient(FIRM);
      // The Household page's rows in change-set order, then the Salary rows' employers.
      const lines = [
        household(seed, { lifeExpectancy: 100 }, "Client — Mark Hendricks"),
        household(seed, { spouseName: "Laura", spouseLastName: "Hendricks", spouseDob: "1975-06-15", spouseLifeExpectancy: 85 }, "Co-client"),
        household(seed, { filingStatus: "married_joint", city: "Denver" }),
        household(seed, { employer: "Acme Corp" }, "Employer — Mark Hendricks"),
        household(seed, { spouseEmployer: "Globex" }, "Employer — Laura Hendricks"),
      ];
      const writeAll = async (ctx: Parameters<typeof W.client_household.update>[0]) => {
        for (const line of lines) await W.client_household.update(ctx, inputOf(line));
        return {
          spouse: await contactOf(seed, "spouse", ctx.tx),
          primary: await contactOf(seed, "primary", ctx.tx),
          members: await householdMembers(seed.clientId, ctx.tx),
          client: await clientRow(seed.clientId, ctx.tx),
          planEndYears: await planEndYears(seed.clientId, ctx.tx),
          spouseOutside: await contactOf(seed, "spouse"),
          membersOutside: await householdMembers(seed.clientId),
        };
      };

      const undone = await inSave(at(seed), writeAll, rollback);
      // On the transaction: each line saw the ones before it.
      expect(undone.result.spouse).toEqual({ firstName: "Laura", dateOfBirth: "1975-06-15", city: null, employer: "Globex" });
      expect(undone.result.primary).toMatchObject({ firstName: "Mark", city: "Denver", employer: "Acme Corp" });
      expect(undone.result.members).toEqual([
        { role: "client", firstName: "Mark", dateOfBirth: "1968-04-12" },
        { role: "spouse", firstName: "Laura", dateOfBirth: "1975-06-15" },
      ]);
      // Plan end = the later death: Mark at 100 (2068) — the Co-client line read his new plan-to age on the transaction.
      expect(undone.result.client).toMatchObject({ lifeExpectancy: 100, spouseLifeExpectancy: 85, planEndAge: 100, filingStatus: "married_joint" });
      expect(undone.result.planEndYears).toEqual([2068]);
      // Outside it, nothing yet.
      expect(undone.result.spouseOutside).toBeNull();
      expect(undone.result.membersOutside.map((m) => m.role)).toEqual(["client"]);
      // Rolled back: the plan as it was, no audit rows.
      expect(await contactOf(seed, "spouse")).toBeNull();
      expect(await contactOf(seed, "primary")).toMatchObject({ city: null, employer: null });
      expect((await householdMembers(seed.clientId)).map((m) => m.role)).toEqual(["client"]);
      expect(await clientRow(seed.clientId)).toMatchObject({ lifeExpectancy: 92, planEndAge: 92, filingStatus: "single" });
      expect(await planEndYears(seed.clientId)).toEqual([2060]);
      expect(await actions(seed.clientId)).toEqual([]);

      const saved = await inSave(at(seed), writeAll);
      expect(saved.queued).toBe(0);
      expect(await contactOf(seed, "spouse")).toEqual({ firstName: "Laura", dateOfBirth: "1975-06-15", city: null, employer: "Globex" });
      expect(await contactOf(seed, "primary")).toMatchObject({ city: "Denver", employer: "Acme Corp" });
      expect((await householdMembers(seed.clientId)).map((m) => [m.role, m.firstName])).toEqual([["client", "Mark"], ["spouse", "Laura"]]);
      expect(await planEndYears(seed.clientId)).toEqual([2068]);
      // One client.update per profile line; the employers write no profile keys.
      expect(await actions(seed.clientId)).toEqual(["client.update", "client.update", "client.update"]);
    });

    it("writes only the line's keys — a blank co-client first name is never sent, so the co-client stays", async () => {
      const seed = await seedSaveClient(FIRM, { coClient: true });
      // The Co-client row with its first name blank: the line carries no spouseName.
      const line = household(seed, { spouseDob: "1971-02-03", spouseRetirementAge: 63 }, "Co-client — Laura Hendricks");
      expect(Object.keys(inputOf(line).body).sort()).toEqual(["spouseDob", "spouseRetirementAge"]);

      await inSave(at(seed), (ctx) => W.client_household.update(ctx, inputOf(line)));
      expect(await contactOf(seed, "spouse")).toMatchObject({ firstName: "Laura", dateOfBirth: "1971-02-03" });
      expect(await householdMembers(seed.clientId)).toEqual([
        { role: "client", firstName: "Mark", dateOfBirth: "1968-04-12" },
        { role: "spouse", firstName: "Laura", dateOfBirth: "1971-02-03" },
      ]);
      expect(await clientRow(seed.clientId)).toMatchObject({ spouseRetirementAge: 63, retirementAge: 65, lifeExpectancy: 92, filingStatus: "married_joint" });
      expect(await contactOf(seed, "primary")).toMatchObject({ firstName: "Mark", dateOfBirth: "1968-04-12" });
    });

    it("a line of employers only writes the employers and leaves the profile alone", async () => {
      const seed = await seedSaveClient(FIRM, { coClient: true });
      const before = await clientRow(seed.clientId);

      await inSave(at(seed), async (ctx) => {
        await W.client_household.update(ctx, inputOf(household(seed, { employer: "Acme Corp" }, "Employer — Mark Hendricks")));
        await W.client_household.update(ctx, inputOf(household(seed, { spouseEmployer: "Globex" }, "Employer — Laura Hendricks")));
      });
      expect((await contactOf(seed, "primary"))?.employer).toBe("Acme Corp");
      expect((await contactOf(seed, "spouse"))?.employer).toBe("Globex");
      expect((await clientRow(seed.clientId)).updatedAt).toEqual(before.updatedAt);
      expect(await actions(seed.clientId)).toEqual([]);
    });

    it("refuses a co-client value when the plan has no co-client and the line adds none", async () => {
      const seed = await seedSaveClient(FIRM);
      const lines: Record<string, PlacedValue>[] = [{ spouseEmployer: "Globex" }, { spouseDob: "1975-06-15" }];
      for (const fields of lines) {
        const line = household(seed, fields, "Co-client");
        await expect(inSave(at(seed), (ctx) => W.client_household.update(ctx, inputOf(line)))).rejects.toThrow(
          new SaveLineError("Add the co-client on the Household page first."),
        );
      }
      // Nothing landed — not even the plan end a co-client's date of birth would have moved.
      expect(await contactOf(seed, "spouse")).toBeNull();
      expect(await clientRow(seed.clientId)).toMatchObject({ planEndAge: 92 });
      expect(await planEndYears(seed.clientId)).toEqual([2060]);
      expect(await actions(seed.clientId)).toEqual([]);
    });

    it("never creates a household or tax settings", async () => {
      const seed = await seedSaveClient(FIRM);
      const line = changeLine("client_household", { city: "Denver" });
      await expect(inSave(at(seed), (ctx) => W.client_household.create(ctx, inputOf(line)))).rejects.toThrow(SaveLineError);
      const settings = changeLine("plan_settings_tax_rates", { residenceState: "AZ" });
      await expect(inSave(at(seed), (ctx) => W.plan_settings_tax_rates.create(ctx, inputOf(settings)))).rejects.toThrow(SaveLineError);
      expect(await contactOf(seed, "primary")).toMatchObject({ city: null });
    });
  });

  describe("tax settings (plan_settings_tax_rates)", () => {
    it("writes the state of residence and both workplace-coverage choices on the transaction", async () => {
      const seed = await seedSaveClient(FIRM, { coClient: true });
      const settings = await baseSettings(seed.clientId);
      const line = changeLine(
        "plan_settings_tax_rates",
        { residenceState: "AZ", coveredByWorkplacePlan: "yes", spouseCoveredByWorkplacePlan: "no" },
        { recordId: settings.id, label: "Tax settings" },
      );
      const write = (ctx: Parameters<typeof W.plan_settings_tax_rates.update>[0]) => W.plan_settings_tax_rates.update(ctx, inputOf(line));

      await inSave(at(seed), write, rollback);
      expect((await baseSettings(seed.clientId)).residenceState).toBe("CO");
      expect(await clientRow(seed.clientId)).toMatchObject({ coveredByWorkplacePlan: "auto", spouseCoveredByWorkplacePlan: "auto" });
      expect(await actions(seed.clientId)).toEqual([]);

      const saved = await inSave(at(seed), write);
      expect(saved.queued).toBe(0);
      expect((await baseSettings(seed.clientId)).residenceState).toBe("AZ");
      expect(await clientRow(seed.clientId)).toMatchObject({ coveredByWorkplacePlan: "yes", spouseCoveredByWorkplacePlan: "no" });
      expect(await actions(seed.clientId)).toEqual(["client.update", "plan_settings.update"]);
    });
  });

  describe("family members (family_member)", () => {
    it("a new child claimed as dependent: the create drops it, the update on the same transaction writes it", async () => {
      const seed = await seedSaveClient(FIRM);
      const line = changeLine("family_member", {
        firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2012-03-04",
        claimedAsDependent: "yes", domesticPartner: false, notes: "Starts college in 2030",
      });
      const children = () => db.select().from(familyMembers).where(and(eq(familyMembers.clientId, seed.clientId), eq(familyMembers.firstName, "Emma")));

      const undone = await inSave(at(seed), (ctx) => W.family_member.create(ctx, inputOf(line)), rollback);
      expect(undone.result).toMatch(/^[0-9a-f-]{36}$/);
      expect(await children()).toEqual([]);
      expect(await actions(seed.clientId)).toEqual([]);

      const saved = await inSave(at(seed), (ctx) => W.family_member.create(ctx, inputOf(line)));
      expect(saved.queued).toBe(0);
      const [emma] = await children();
      expect(emma).toMatchObject({
        id: saved.result, lastName: "Hendricks", relationship: "child", dateOfBirth: "2012-03-04",
        claimedAsDependent: "yes", domesticPartner: false, notes: "Starts college in 2030", role: "other",
      });
      expect(await actions(seed.clientId)).toEqual(["family_member.create", "family_member.update"]);
    });

    it("updates a family member on the transaction with only the line's keys", async () => {
      const seed = await seedSaveClient(FIRM);
      const [noah] = await db
        .insert(familyMembers)
        .values({ clientId: seed.clientId, firstName: "Noah", lastName: "Hendricks", relationship: "child", dateOfBirth: "2009-11-02" })
        .returning();
      const line = changeLine("family_member", { claimedAsDependent: "no", notes: "Lives on his own" }, { recordId: noah.id, label: "Noah Hendricks" });
      const write = (ctx: Parameters<typeof W.family_member.update>[0]) => W.family_member.update(ctx, inputOf(line));
      const read = async () => (await db.select().from(familyMembers).where(eq(familyMembers.id, noah.id)))[0];

      await inSave(at(seed), write, rollback);
      expect(await read()).toMatchObject({ claimedAsDependent: "auto", notes: null });
      expect(await actions(seed.clientId)).toEqual([]);

      await inSave(at(seed), write);
      expect(await read()).toMatchObject({ firstName: "Noah", dateOfBirth: "2009-11-02", relationship: "child", claimedAsDependent: "no", notes: "Lives on his own" });
      expect(await actions(seed.clientId)).toEqual(["family_member.update"]);
    });
  });
});
