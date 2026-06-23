import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms, clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import {
  loadFormByToken,
  loadFormForFirm,
  loadActivePrefilledForm,
  hasUnsubmittedPrefilledForm,
} from "../queries";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";

const FIRM_ID = "org_queries_test";
const ADVISOR_ID = "advisor_queries_test";

// IDs populated in beforeAll
let draftClientId: string;
let submittedClientId: string;
const householdIds: string[] = [];

async function seedClientAndHousehold(): Promise<string> {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM_ID, advisorId: ADVISOR_ID, name: `HH ${Math.random()}` })
    .returning({ id: crmHouseholds.id });
  householdIds.push(hh.id);

  await db.insert(crmHouseholdContacts).values({
    householdId: hh.id,
    role: "primary",
    firstName: "Test",
    lastName: "User",
  });

  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM_ID,
      advisorId: ADVISOR_ID,
      crmHouseholdId: hh.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning({ id: clients.id });

  return client.id;
}

beforeAll(async () => {
  draftClientId = await seedClientAndHousehold();
  submittedClientId = await seedClientAndHousehold();

  await db.insert(intakeForms).values([
    {
      firmId: FIRM_ID,
      clientId: draftClientId,
      mode: "prefilled" as const,
      status: "draft" as const,
      token: newIntakeToken(),
      recipientEmail: "draft@example.com",
      payload: {} as unknown as IntakePayload,
      createdByUserId: "user_test",
      expiresAt: defaultExpiry(new Date()),
    },
    {
      firmId: FIRM_ID,
      clientId: submittedClientId,
      mode: "prefilled" as const,
      status: "submitted" as const,
      token: newIntakeToken(),
      recipientEmail: "submitted@example.com",
      payload: {} as unknown as IntakePayload,
      createdByUserId: "user_test",
      expiresAt: defaultExpiry(new Date()),
    },
  ]);
}, 30000);

afterAll(async () => {
  await db.delete(intakeForms).where(eq(intakeForms.firmId, FIRM_ID));
  await db.delete(clients).where(eq(clients.firmId, FIRM_ID));
  for (const hhId of householdIds) {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, hhId));
  }
}, 30000);

describe("intake queries", () => {
  it("loads by token and scopes by firm", async () => {
    const token = newIntakeToken();
    const [row] = await db.insert(intakeForms).values({
      firmId: "org_test", mode: "blank", token,
      recipientEmail: "c@x.com", createdByUserId: "user_1",
      expiresAt: defaultExpiry(new Date()),
    }).returning();

    try {
      expect((await loadFormByToken(token))?.id).toBe(row.id);
      expect(await loadFormByToken("nope")).toBeNull();
      expect((await loadFormForFirm(row.id, "org_test"))?.id).toBe(row.id);
      expect(await loadFormForFirm(row.id, "org_other")).toBeNull();
    } finally {
      await db.delete(intakeForms).where(eq(intakeForms.id, row.id));
    }
  });

  it("loadActivePrefilledForm returns null when no match", async () => {
    // No prefilled form exists for this non-existent client — confirms the
    // query runs without error and returns null on no match.
    const result = await loadActivePrefilledForm(
      "00000000-0000-0000-0000-000000000099",
    );
    expect(result).toBeNull();
  });

  it("hasUnsubmittedPrefilledForm returns false when no match", async () => {
    // Mirrors the middleware soft-route check: no row → false.
    const result = await hasUnsubmittedPrefilledForm(
      "00000000-0000-0000-0000-000000000099",
    );
    expect(result).toBe(false);
  });

  it("hasUnsubmittedPrefilledForm: draft→true, submitted→false (status filter is draft-only)", async () => {
    // Draft form → true (the soft-gate should redirect this client to intake)
    const draftResult = await hasUnsubmittedPrefilledForm(draftClientId);
    expect(draftResult).toBe(true);

    // Submitted form → false (the soft-gate must NOT redirect after submission)
    const submittedResult = await hasUnsubmittedPrefilledForm(submittedClientId);
    expect(submittedResult).toBe(false);
  }, 30000);
});
