// src/lib/imports/__tests__/plan-builder-principal.test.ts
//
// Live dev database: `ensurePlanImport` run on a principal, with no Clerk
// session — as the Claude connector runs it. A brand-new household, a plan for
// an existing prospect, and the prospect refusals. Everything lives under a
// firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// No session at all: every access check and audit actor must come from the principal.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null, orgId: null, orgRole: null, actor: null }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clientImports, clients, crmHouseholdContacts, crmHouseholds, crmHouseholdViews } from "@/db/schema";
import type { Principal } from "@/lib/clients/authz";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { dropSaveFirm } from "@/lib/fact-finder/save/__tests__/harness";
import { ensurePlanImport } from "../plan-builder-core";

const FIRM = "firm_test_plan_builder_principal";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

/** The advisor the connector call runs as. */
const ADVISOR: Principal = { userId: "user_test_plan_builder_advisor", orgId: FIRM, orgRole: "org:admin" };
/** Another advisor of the same firm, whose book a prospect sits in. */
const OTHER_ADVISOR = "user_test_plan_builder_other";
const LABEL = "Claude: Household";

/** A prospect household in OTHER_ADVISOR's book, with no plan. */
async function seedProspect(primary: { firstName: string; lastName: string; dateOfBirth: string | null }) {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: OTHER_ADVISOR, name: `${primary.firstName} ${primary.lastName}`, status: "prospect", state: "OR" })
    .returning({ id: crmHouseholds.id });
  await db.insert(crmHouseholdContacts).values([
    { householdId: household.id, role: "primary", ...primary },
    { householdId: household.id, role: "spouse", firstName: "Ivy", lastName: primary.lastName, dateOfBirth: "1972-11-20" },
  ]);
  return household.id;
}

const prospectArgs = (householdId: string) => ({
  mode: "prospect" as const,
  principal: ADVISOR,
  firmId: FIRM,
  actorUserId: ADVISOR.userId,
  label: LABEL,
  prospect: {
    householdId,
    filingStatus: "married_joint" as const,
    retirementAge: 65,
    lifeExpectancy: 95,
    spouseRetirementAge: 63,
    spouseLifeExpectancy: 95,
  },
});

const clientsOf = (householdId: string) =>
  db.select({ id: clients.id }).from(clients).where(eq(clients.crmHouseholdId, householdId));

async function auditActor(action: string, resourceId: string) {
  const [row] = await db
    .select({ actorId: auditLog.actorId })
    .from(auditLog)
    .where(and(eq(auditLog.firmId, FIRM), eq(auditLog.action, action), eq(auditLog.resourceId, resourceId)));
  return row?.actorId;
}

/** Whether the household sits in the user's "Recently opened" list. */
async function opened(householdId: string, userId: string) {
  const rows = await db
    .select({ userId: crmHouseholdViews.userId })
    .from(crmHouseholdViews)
    .where(and(eq(crmHouseholdViews.householdId, householdId), eq(crmHouseholdViews.userId, userId)));
  return rows.length === 1;
}

d("ensurePlanImport on a principal, with no session (live DB)", () => {
  // Clearing a firm of its households can outlast the default hook timeout on a cold dev branch.
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("creates a new household, plan and fact finder import with a principal", async () => {
    const result = await ensurePlanImport({
      mode: "new",
      principal: ADVISOR,
      firmId: FIRM,
      actorUserId: ADVISOR.userId,
      label: LABEL,
      newHousehold: {
        householdName: "Plan 5 Check",
        primary: { firstName: "Mark", lastName: "Check", dateOfBirth: "1970-03-02" },
        filingStatus: "single",
        retirementAge: 65,
        lifeExpectancy: 95,
      },
    });

    const [imp] = await db
      .select({ notes: clientImports.notes, createdByUserId: clientImports.createdByUserId, mode: clientImports.mode })
      .from(clientImports)
      .where(eq(clientImports.id, result.importId));
    expect(imp).toEqual({ notes: LABEL, createdByUserId: ADVISOR.userId, mode: "onboarding" });

    const [client] = await db
      .select({ advisorId: clients.advisorId, householdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, result.clientId));
    expect(client.advisorId).toBe(ADVISOR.userId);

    expect(await auditActor("crm.household.create", client.householdId)).toBe(ADVISOR.userId);
    expect(await auditActor("client.create", result.clientId)).toBe(ADVISOR.userId);
    expect(await auditActor("import.created", result.importId)).toBe(ADVISOR.userId);
    expect(await opened(client.householdId, ADVISOR.userId)).toBe(true);
  });

  it("starts a plan for a prospect, in the household advisor's book", async () => {
    const householdId = await seedProspect({ firstName: "Nora", lastName: "Fieldstone", dateOfBirth: "1971-05-14" });

    const result = await ensurePlanImport(prospectArgs(householdId));

    const [client] = await db
      .select({ advisorId: clients.advisorId, householdId: clients.crmHouseholdId, spouseRetirementAge: clients.spouseRetirementAge })
      .from(clients)
      .where(eq(clients.id, result.clientId));
    expect(client).toEqual({ advisorId: OTHER_ADVISOR, householdId, spouseRetirementAge: 63 });

    const [imp] = await db
      .select({ notes: clientImports.notes, createdByUserId: clientImports.createdByUserId, mode: clientImports.mode })
      .from(clientImports)
      .where(eq(clientImports.id, result.importId));
    expect(imp).toEqual({ notes: LABEL, createdByUserId: ADVISOR.userId, mode: "onboarding" });

    expect(await auditActor("client.create", result.clientId)).toBe(ADVISOR.userId);
    expect(await opened(householdId, ADVISOR.userId)).toBe(true);
  });

  it("refuses a prospect that already has a plan", async () => {
    const householdId = await seedProspect({ firstName: "Owen", lastName: "Larkspur", dateOfBirth: "1966-08-09" });
    await createClientForHousehold({
      household: { id: householdId, firmId: FIRM, advisorId: OTHER_ADVISOR, state: "OR" },
      primaryContact: { firstName: "Owen", lastName: "Larkspur", dateOfBirth: "1966-08-09" },
      retirementAge: 65,
      lifeExpectancy: 95,
      filingStatus: "single",
    });

    await expect(ensurePlanImport(prospectArgs(householdId))).rejects.toThrow("This household already has a plan.");
    expect(await clientsOf(householdId)).toHaveLength(1);
  });

  it("refuses a prospect whose primary contact has no date of birth", async () => {
    const householdId = await seedProspect({ firstName: "Pia", lastName: "Thornbury", dateOfBirth: null });

    await expect(ensurePlanImport(prospectArgs(householdId))).rejects.toThrow(
      "The household's primary contact needs a date of birth.",
    );
    expect(await clientsOf(householdId)).toHaveLength(0);
  });

  it("refuses a married prospect without the spouse's retirement age", async () => {
    const householdId = await seedProspect({ firstName: "Rhea", lastName: "Morrowind", dateOfBirth: "1969-12-03" });
    const args = prospectArgs(householdId);

    await expect(
      ensurePlanImport({ ...args, prospect: { ...args.prospect, spouseRetirementAge: undefined } }),
    ).rejects.toThrow("The spouse's retirement age is required.");
    expect(await clientsOf(householdId)).toHaveLength(0);
  });

  it("refuses a prospect the principal cannot see, as if it did not exist", async () => {
    const householdId = await seedProspect({ firstName: "Quinn", lastName: "Ashgrove", dateOfBirth: "1975-02-27" });

    await expect(
      ensurePlanImport({ ...prospectArgs(householdId), principal: { ...ADVISOR, orgId: "org_other" } }),
    ).rejects.toThrow("Household not found or access denied.");
    expect(await clientsOf(householdId)).toHaveLength(0);
  });
});
