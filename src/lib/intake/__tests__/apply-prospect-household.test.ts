/**
 * DB integration test for applyIntake's prospect path when a document upload
 * already minted a household.
 *
 * A prospect who attaches a statement BEFORE submitting gets a CRM household
 * minted by resolveIntakeHousehold and parked on intake_forms.crm_household_id.
 * applyIntake must ADOPT that household rather than insert a second one —
 * otherwise the uploaded documents are stranded on an orphan record that no
 * client row points at.
 *
 * Note: Neon dev branch cold-starts after idle; run with --testTimeout=30000.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  expenses,
  familyMembers,
  incomes,
  intakeForms,
  liabilities,
  scenarios,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import { applyIntake } from "../apply";
import { resolveIntakeHousehold, placeholderHouseholdName } from "../documents";

const FIRM = "test-firm-apply-prospect-hh-2026";
const ADVISOR = "user_test_apply_prospect_hh";
const RECIPIENT_NAME = "Jordan Reyes";
const RECIPIENT_EMAIL = "jordan@example.com";

// A second firm, used only by the cross-firm guard test below.
const OTHER_FIRM = "test-firm-apply-prospect-hh-other-2026";
const OTHER_ADVISOR = "user_test_apply_prospect_hh_other";
const FOREIGN_NAME = "Someone Else's Household";

/** What resolveIntakeHousehold names the household on the upload path. */
const PLACEHOLDER = placeholderHouseholdName(RECIPIENT_NAME, RECIPIENT_EMAIL);
/** What deriveHouseholdNameFromContacts produces for a lone primary. */
const REAL_NAME = "Jordan Reyes";

const PAYLOAD: IntakePayload = {
  family: {
    primary: {
      firstName: "Jordan",
      lastName: "Reyes",
      dateOfBirth: "1980-04-11",
      maritalStatus: "single",
    },
    spouse: null,
    stateOfResidence: "NJ",
    children: [],
  },
  accounts: [],
  income: [],
  property: [],
  goals: { expenseGoals: [], topics: [] },
  meta: { completedSections: [] },
};

/**
 * Every case here seeds its own form and applies it, so the firm scope has to
 * start empty or the "exactly one household" assertions read rows another case
 * left behind. afterAll alone is too coarse — clear before each test.
 *
 * Ordering mirrors apply.test.ts's cleanup(): liabilities + accounts before
 * familyMembers, because deleting a family member cascades its account_owners /
 * liability_owners rows and the deferred owner-sum triggers then raise on the
 * still-present account or liability. plan_settings and crm_activity are ON
 * DELETE CASCADE from scenarios/clients and crm_households respectively.
 */
async function clearFirm(firmId: string): Promise<void> {
  // intake_forms references BOTH clients and crm_households — drop it first
  // rather than lean on its ON DELETE SET NULL.
  await db.delete(intakeForms).where(eq(intakeForms.firmId, firmId));

  const clientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.firmId, firmId));
  const clientIds = clientRows.map((c) => c.id);
  if (clientIds.length > 0) {
    await db.delete(liabilities).where(inArray(liabilities.clientId, clientIds));
    await db.delete(accounts).where(inArray(accounts.clientId, clientIds));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, clientIds));
    await db.delete(incomes).where(inArray(incomes.clientId, clientIds));
    await db.delete(expenses).where(inArray(expenses.clientId, clientIds));
    await db.delete(scenarios).where(inArray(scenarios.clientId, clientIds));
    await db.delete(clients).where(inArray(clients.id, clientIds));
  }

  const hhRows = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, firmId));
  const hhIds = hhRows.map((h) => h.id);
  if (hhIds.length > 0) {
    await db
      .delete(crmHouseholdContacts)
      .where(inArray(crmHouseholdContacts.householdId, hhIds));
    await db.delete(crmHouseholds).where(inArray(crmHouseholds.id, hhIds));
  }
}

/** FIRM before OTHER_FIRM: if the cross-firm guard ever regresses, a client in
 *  FIRM points at a household OTHER_FIRM owns, so that client has to go first.
 *  Wrapped rather than passed to beforeEach directly — vitest hands the hook a
 *  TestContext, which would arrive as `firmId`. */
async function clearBothFirms(): Promise<void> {
  await clearFirm(FIRM);
  await clearFirm(OTHER_FIRM);
}

beforeEach(clearBothFirms);
afterAll(clearBothFirms);

async function seedSubmittedProspectForm(): Promise<string> {
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId: FIRM,
      clientId: null,
      mode: "blank",
      status: "submitted",
      token: newIntakeToken(),
      recipientEmail: RECIPIENT_EMAIL,
      recipientName: RECIPIENT_NAME,
      payload: PAYLOAD,
      createdByUserId: ADVISOR,
      expiresAt: defaultExpiry(new Date()),
      submittedAt: new Date(),
    })
    .returning({ id: intakeForms.id });
  return form.id;
}

async function householdIdsInFirm(): Promise<string[]> {
  const rows = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, FIRM));
  return rows.map((r) => r.id);
}

describe("applyIntake — prospect with a pre-minted household", () => {
  it("adopts the household created by an upload instead of making a second one", async () => {
    const formId = await seedSubmittedProspectForm();
    // Simulate the client having uploaded a document before submitting.
    const preMinted = await resolveIntakeHousehold(formId);

    const { clientId } = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });

    expect(await householdIdsInFirm()).toEqual([preMinted]);

    const [client] = await db
      .select({ crmHouseholdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, clientId));
    expect(client.crmHouseholdId).toBe(preMinted);
  });

  it("overwrites the placeholder household name with the real one", async () => {
    const formId = await seedSubmittedProspectForm();
    const preMinted = await resolveIntakeHousehold(formId);

    // The upload path only had recipientName to go on, so the row starts out
    // carrying the placeholder and no state.
    const [before] = await db
      .select({ name: crmHouseholds.name, state: crmHouseholds.state })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, preMinted));
    expect(before.name).toBe(PLACEHOLDER); // "Jordan Reyes Household"
    expect(before.state).toBeNull();

    await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });

    // Read the pre-minted row by id, not "the one row in the firm" — this has
    // to fail loudly if apply leaves the placeholder untouched on a second row.
    const [after] = await db
      .select({ name: crmHouseholds.name, state: crmHouseholds.state })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, preMinted));
    expect(after.name).not.toBe(PLACEHOLDER);
    expect(after.name).toBe(REAL_NAME);
    expect(after.state).toBe("NJ");
  });

  it("still creates a household when nothing was pre-minted", async () => {
    const formId = await seedSubmittedProspectForm();

    const { clientId } = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });
    expect(clientId).toBeTruthy();

    const [client] = await db
      .select({ crmHouseholdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, clientId));
    const householdId = client.crmHouseholdId;
    expect(householdId).toBeTruthy();
    expect(await householdIdsInFirm()).toEqual([householdId]);

    // Scoped to THIS household — an unscoped count passes on rows any other
    // test left on the shared dev branch and can never fail.
    const contacts = await db
      .select({
        role: crmHouseholdContacts.role,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
        email: crmHouseholdContacts.email,
      })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, householdId!));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      role: "primary",
      firstName: "Jordan",
      lastName: "Reyes",
      email: RECIPIENT_EMAIL,
    });
  });

  it("remains idempotent — a second apply is a no-op", async () => {
    const formId = await seedSubmittedProspectForm();
    const preMinted = await resolveIntakeHousehold(formId);

    const first = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });
    const second = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });

    expect(second.clientId).toBe(first.clientId);
    expect(await householdIdsInFirm()).toEqual([preMinted]);

    // A second client (or a second contact set) would mean the re-apply rebuilt
    // the tree onto the adopted household instead of short-circuiting.
    const clientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.firmId, FIRM));
    expect(clientRows).toHaveLength(1);

    const contacts = await db
      .select({ id: crmHouseholdContacts.id })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, preMinted));
    expect(contacts).toHaveLength(1);
  });

  it("refuses a household parked from another firm, and rolls the apply back", async () => {
    const formId = await seedSubmittedProspectForm();

    // A household owned by a DIFFERENT firm, parked on this form. Not reachable
    // through today's writers — resolveIntakeHousehold always mints against the
    // form's own firm — but the guard has to hold the moment a second writer of
    // crm_household_id exists (e.g. "link this form to an existing household").
    const [foreign] = await db
      .insert(crmHouseholds)
      .values({ firmId: OTHER_FIRM, advisorId: OTHER_ADVISOR, name: FOREIGN_NAME })
      .returning({ id: crmHouseholds.id });

    await db
      .update(intakeForms)
      .set({ crmHouseholdId: foreign.id, updatedAt: new Date() })
      .where(eq(intakeForms.id, formId));

    await expect(
      applyIntake({ formId, firmId: FIRM, actorId: ADVISOR }),
    ).rejects.toThrow(/outside firm/);

    // A throw on its own isn't the guarantee — the transaction has to roll back,
    // or the apply leaves a half-built client wired to another firm's household.
    const clientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.firmId, FIRM));
    expect(clientRows).toHaveLength(0);

    const contacts = await db
      .select({ id: crmHouseholdContacts.id })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, foreign.id));
    expect(contacts).toHaveLength(0);

    // The other firm's household is untouched — this is the row the unguarded
    // UPDATE would have renamed out from under them.
    const [after] = await db
      .select({ name: crmHouseholds.name, state: crmHouseholds.state })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, foreign.id));
    expect(after.name).toBe(FOREIGN_NAME);
    expect(after.state).toBeNull();

    // The form stays applicable rather than being flipped to "applied".
    const [form] = await db
      .select({ status: intakeForms.status, clientId: intakeForms.clientId })
      .from(intakeForms)
      .where(eq(intakeForms.id, formId));
    expect(form.status).toBe("submitted");
    expect(form.clientId).toBeNull();
  });
});
