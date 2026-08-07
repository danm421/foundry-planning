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
let docsOnlyClientId: string;
let twoFormClientId: string;
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
  docsOnlyClientId = await seedClientAndHousehold();
  twoFormClientId = await seedClientAndHousehold();

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
    {
      // Draft, but it collects only documents — and the portal wizard has no
      // upload surface, so there is nothing for this client to fill in.
      firmId: FIRM_ID,
      clientId: docsOnlyClientId,
      mode: "prefilled" as const,
      status: "draft" as const,
      token: newIntakeToken(),
      recipientEmail: "docsonly@example.com",
      payload: {} as unknown as IntakePayload,
      sections: ["documents"],
      createdByUserId: "user_test",
      expiresAt: defaultExpiry(new Date()),
    },
    // Two active forms for ONE client — an advisor resending data collection.
    // The older one collects only documents; the newer is a full intake. The
    // soft gate and the portal page must resolve to the SAME row (the newer),
    // or they redirect at each other forever. Explicit createdAt values: a
    // batch insert would stamp both with the same transaction clock.
    {
      firmId: FIRM_ID,
      clientId: twoFormClientId,
      mode: "prefilled" as const,
      status: "submitted" as const,
      token: newIntakeToken(),
      recipientEmail: "older-docs-only@example.com",
      payload: {} as unknown as IntakePayload,
      sections: ["documents"],
      createdByUserId: "user_test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: defaultExpiry(new Date()),
    },
    {
      firmId: FIRM_ID,
      clientId: twoFormClientId,
      mode: "prefilled" as const,
      status: "draft" as const,
      token: newIntakeToken(),
      recipientEmail: "newer-full-intake@example.com",
      payload: {} as unknown as IntakePayload,
      createdByUserId: "user_test",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
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

  it("hasUnsubmittedPrefilledForm: false for a draft the portal cannot render", async () => {
    // A documents-only form is a real draft, but the portal has no upload
    // surface — the wizard would be Welcome → Review with nothing between.
    // The gate must not push the client at a page that will bounce them back
    // to the Organizer: the two redirects would form an infinite loop.
    expect(await hasUnsubmittedPrefilledForm(docsOnlyClientId)).toBe(false);
  }, 30000);

  it("the soft gate answers about the SAME form the portal page will render", async () => {
    // With two active forms, the gate deciding on one row while the page
    // renders another is an infinite redirect: the page bounces a form it
    // cannot render to the Organizer, and the gate pushes straight back.
    // Both must resolve the newest form.
    const active = await loadActivePrefilledForm(twoFormClientId);
    expect(active?.recipientEmail).toBe("newer-full-intake@example.com");
    expect(await hasUnsubmittedPrefilledForm(twoFormClientId)).toBe(true);
  }, 30000);
});
