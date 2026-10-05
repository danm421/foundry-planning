/**
 * DB integration test for linkIntakeFormToClient: an advisor sent a blank form,
 * entered the household by hand before it came back, and now points the
 * submission at that client so Apply merges instead of duplicating.
 *
 * Note: Neon dev branch cold-starts after idle; run with --testTimeout=30000.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmDocumentFolders,
  crmHouseholds,
  crmHouseholdContacts,
  crmHouseholdDocuments,
  expenses,
  familyMembers,
  incomes,
  intakeForms,
  liabilities,
  scenarios,
} from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import { applyIntake } from "../apply";
import { resolveIntakeHousehold } from "../documents";
import { linkIntakeFormToClient } from "../link-client";
import { INTAKE_FOLDER_NAME } from "@/lib/crm/folders";

const FIRM = "test-firm-intake-link-client-2026";
const OTHER_FIRM = "test-firm-intake-link-client-other-2026";
const ADVISOR = "user_test_intake_link_client";

function payload(accountNames: string[]): IntakePayload {
  return {
    family: {
      primary: {
        firstName: "Morgan",
        lastName: "Ellis",
        dateOfBirth: "1979-02-03",
        maritalStatus: "single",
      },
      spouse: null,
      stateOfResidence: "OR",
      children: [],
    },
    accounts: accountNames.map((name) => ({
      name,
      category: "taxable" as const,
      value: 10000,
      owner: "client" as const,
    })),
    income: [],
    property: [],
    goals: { expenseGoals: [], topics: [] },
    meta: { completedSections: [] },
  };
}

/** Same ordering as apply-prospect-household.test.ts: liabilities + accounts
 *  before familyMembers (owner-sum triggers), forms before what they point at.
 *  Households cascade their documents and folders. */
async function clearFirm(firmId: string): Promise<void> {
  await db.delete(intakeForms).where(eq(intakeForms.firmId, firmId));
  const clientIds = (
    await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, firmId))
  ).map((c) => c.id);
  if (clientIds.length > 0) {
    await db.delete(liabilities).where(inArray(liabilities.clientId, clientIds));
    await db.delete(accounts).where(inArray(accounts.clientId, clientIds));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, clientIds));
    await db.delete(incomes).where(inArray(incomes.clientId, clientIds));
    await db.delete(expenses).where(inArray(expenses.clientId, clientIds));
    await db.delete(scenarios).where(inArray(scenarios.clientId, clientIds));
    await db.delete(clients).where(inArray(clients.id, clientIds));
  }
  const hhIds = (
    await db.select({ id: crmHouseholds.id }).from(crmHouseholds).where(eq(crmHouseholds.firmId, firmId))
  ).map((h) => h.id);
  if (hhIds.length > 0) {
    await db.delete(crmHouseholdContacts).where(inArray(crmHouseholdContacts.householdId, hhIds));
    await db.delete(crmHouseholds).where(inArray(crmHouseholds.id, hhIds));
  }
}

async function clearBothFirms(): Promise<void> {
  await clearFirm(FIRM);
  await clearFirm(OTHER_FIRM);
}

beforeEach(clearBothFirms);
afterAll(clearBothFirms);

async function seedSubmittedProspectForm(firmId: string, accountNames: string[]): Promise<string> {
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId,
      clientId: null,
      mode: "blank",
      status: "submitted",
      token: newIntakeToken(),
      recipientEmail: "morgan@example.com",
      recipientName: "Morgan Ellis",
      payload: payload(accountNames),
      createdByUserId: ADVISOR,
      expiresAt: defaultExpiry(new Date()),
      submittedAt: new Date(),
    })
    .returning({ id: intakeForms.id });
  return form.id;
}

/** The hand-entered client: a real client tree, built the quickest way there is. */
async function seedExistingClient(firmId: string): Promise<{ clientId: string; householdId: string }> {
  const formId = await seedSubmittedProspectForm(firmId, ["Hand-entered brokerage"]);
  const { clientId } = await applyIntake({ formId, firmId, actorId: ADVISOR });
  const [client] = await db
    .select({ householdId: clients.crmHouseholdId })
    .from(clients)
    .where(eq(clients.id, clientId));
  return { clientId, householdId: client.householdId! };
}

/** A prospect upload: mints the placeholder household, then files a document
 *  on it the way uploadIntakeDocument does (minus the blob). */
async function uploadOnto(formId: string): Promise<{ placeholder: string; docId: string }> {
  const placeholder = await resolveIntakeHousehold(formId);
  const [doc] = await db
    .insert(crmHouseholdDocuments)
    .values({
      householdId: placeholder,
      filename: "statement.pdf",
      storageProvider: "vercel-blob",
      storageKey: `crm/${placeholder}/statement.pdf`,
      sourceKind: "intake_upload",
      description: "statement",
    })
    .returning({ id: crmHouseholdDocuments.id });
  return { placeholder, docId: doc.id };
}

describe("linkIntakeFormToClient", () => {
  it("points the form at the client, and Apply then merges instead of duplicating", async () => {
    const existing = await seedExistingClient(FIRM);
    const formId = await seedSubmittedProspectForm(FIRM, ["Roth IRA from the form"]);

    expect(
      await linkIntakeFormToClient({ formId, firmId: FIRM, clientId: existing.clientId, actorId: ADVISOR }),
    ).toBe("linked");

    const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, formId));
    expect(form.clientId).toBe(existing.clientId);

    const { clientId } = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });
    expect(clientId).toBe(existing.clientId);

    const firmClients = await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, FIRM));
    expect(firmClients).toEqual([{ id: existing.clientId }]);

    // The form's account landed on the existing client, next to the hand-entered one.
    const names = (
      await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.clientId, existing.clientId))
    ).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Hand-entered brokerage", "Roth IRA from the form"]));
  });

  it("moves uploaded documents onto the client and trashes the emptied placeholder", async () => {
    const existing = await seedExistingClient(FIRM);
    const formId = await seedSubmittedProspectForm(FIRM, []);
    const { placeholder, docId } = await uploadOnto(formId);

    await linkIntakeFormToClient({ formId, firmId: FIRM, clientId: existing.clientId, actorId: ADVISOR });

    const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, formId));
    expect(form.crmHouseholdId).toBeNull();

    const [doc] = await db.select().from(crmHouseholdDocuments).where(eq(crmHouseholdDocuments.id, docId));
    expect(doc.householdId).toBe(existing.householdId);
    const [folder] = await db
      .select({ householdId: crmDocumentFolders.householdId, name: crmDocumentFolders.name })
      .from(crmDocumentFolders)
      .where(eq(crmDocumentFolders.id, doc.folderId!));
    expect(folder).toEqual({ householdId: existing.householdId, name: INTAKE_FOLDER_NAME });

    const [hh] = await db.select().from(crmHouseholds).where(eq(crmHouseholds.id, placeholder));
    expect(hh.deletedAt).not.toBeNull();
    expect(hh.deletedBy).toBe(ADVISOR);

    // And Apply leaves exactly one live household in the firm.
    await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });
    const live = await db
      .select({ id: crmHouseholds.id })
      .from(crmHouseholds)
      .where(and(eq(crmHouseholds.firmId, FIRM), isNull(crmHouseholds.deletedAt)));
    expect(live).toEqual([{ id: existing.householdId }]);
  });

  it("keeps the placeholder when something else has landed on it", async () => {
    const existing = await seedExistingClient(FIRM);
    const formId = await seedSubmittedProspectForm(FIRM, []);
    const { placeholder } = await uploadOnto(formId);
    // The advisor added a contact to it in the CRM meanwhile.
    await db.insert(crmHouseholdContacts).values({
      householdId: placeholder,
      role: "primary",
      firstName: "Morgan",
      lastName: "Ellis",
    });

    await linkIntakeFormToClient({ formId, firmId: FIRM, clientId: existing.clientId, actorId: ADVISOR });

    const [hh] = await db.select().from(crmHouseholds).where(eq(crmHouseholds.id, placeholder));
    expect(hh.deletedAt).toBeNull();
  });

  it("refuses a form that is already tied to a client or no longer awaiting review", async () => {
    const existing = await seedExistingClient(FIRM);
    const formId = await seedSubmittedProspectForm(FIRM, []);
    const link = () =>
      linkIntakeFormToClient({ formId, firmId: FIRM, clientId: existing.clientId, actorId: ADVISOR });

    expect(await link()).toBe("linked");
    expect(await link()).toBe("conflict");

    const draftId = await seedSubmittedProspectForm(FIRM, []);
    await db.update(intakeForms).set({ status: "draft", submittedAt: null }).where(eq(intakeForms.id, draftId));
    expect(
      await linkIntakeFormToClient({ formId: draftId, firmId: FIRM, clientId: existing.clientId, actorId: ADVISOR }),
    ).toBe("conflict");
  });

  it("will not link across firms", async () => {
    const foreign = await seedExistingClient(OTHER_FIRM);
    const formId = await seedSubmittedProspectForm(FIRM, []);

    expect(
      await linkIntakeFormToClient({ formId, firmId: FIRM, clientId: foreign.clientId, actorId: ADVISOR }),
    ).toBe("client_not_found");
    expect(
      await linkIntakeFormToClient({ formId, firmId: OTHER_FIRM, clientId: foreign.clientId, actorId: ADVISOR }),
    ).toBe("form_not_found");

    const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, formId));
    expect(form.clientId).toBeNull();
  });
});
