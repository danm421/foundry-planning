/**
 * snapshotClientToPayload — read-only snapshot of a client's live data
 * shaped into IntakePayload for pre-filling the portal intake form.
 *
 * No writes. Bypasses verifyClientAccess (which requires Clerk auth) because
 * this function is called in server-side contexts that have already verified
 * access (the portal-invite route, advisor-review route). The firmId parameter
 * is the org-scoping guard.
 */

import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  familyMembers,
  scenarios,
  accounts,
  incomes,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { IntakePayload } from "@/lib/intake/schema";

// ── DB → form category mapping ────────────────────────────────────────────────
//
// DB accountCategoryEnum has 9 members; the form accepts only 5.
//
// | DB category       | Form disposition                          |
// |-------------------|-------------------------------------------|
// | taxable           | pass-through → accounts.category          |
// | cash              | pass-through → accounts.category          |
// | retirement        | pass-through → accounts.category          |
// | annuity           | pass-through → accounts.category          |
// | life_insurance    | pass-through → accounts.category          |
// | real_estate       | emit as property entry (kind=real_estate)  |
// | business          | emit as property entry (kind=business)     |
// | stock_options     | DROP — no form representation             |
// | notes_receivable  | DROP — no form representation             |

type IntakeAccountCategory = "taxable" | "cash" | "retirement" | "annuity" | "life_insurance";

const FORM_ACCOUNT_CATEGORIES = new Set<string>([
  "taxable",
  "cash",
  "retirement",
  "annuity",
  "life_insurance",
]);

const PROPERTY_CATEGORIES = new Set<string>(["real_estate", "business"]);

// ── Income type mapping ───────────────────────────────────────────────────────
//
// DB incomeTypeEnum: salary | social_security | business | deferred |
//                   capital_gains | trust | other
// Form income types: salary | social_security | business | other
// Mapping: DB "deferred" | "capital_gains" | "trust" → form "other"

type IntakeIncomeType = "salary" | "social_security" | "business" | "other";

function mapIncomeType(dbType: string): IntakeIncomeType {
  switch (dbType) {
    case "salary":
    case "social_security":
    case "business":
      return dbType;
    default:
      // deferred, capital_gains, trust, other → other
      return "other";
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Read a client's live planning data and return it as an IntakePayload.
 * The result seeds the pre-filled portal intake form — no advisor edits have
 * been applied yet, and the form's curated subset may omit data (e.g.
 * stock_options accounts) that the full plan contains.
 *
 * Throws if the client is not found in the given firm.
 */
export async function snapshotClientToPayload(
  clientId: string,
  firmId: string,
): Promise<IntakePayload> {
  // ── 1. Load client row ────────────────────────────────────────────────────
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
    .limit(1);

  if (!client) {
    throw new Error(`Client ${clientId} not found in firm ${firmId}`);
  }

  // ── 2. Load household state ───────────────────────────────────────────────
  const [household] = await db
    .select({ state: crmHouseholds.state })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, client.crmHouseholdId))
    .limit(1);

  const stateOfResidence = household?.state ?? undefined;

  // ── 3. Load household contacts (primary + spouse) ─────────────────────────
  const contacts = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));

  const primaryContact = contacts.find((c) => c.role === "primary");
  const spouseContact = contacts.find((c) => c.role === "spouse");

  if (!primaryContact) {
    throw new Error(`No primary contact for household ${client.crmHouseholdId}`);
  }

  // ── 4. Build family.primary ───────────────────────────────────────────────
  const primary: IntakePayload["family"]["primary"] = {
    firstName: primaryContact.firstName,
    lastName: primaryContact.lastName,
    dateOfBirth: primaryContact.dateOfBirth ?? "",
    maritalStatus: (primaryContact.maritalStatus ?? undefined) as
      | "single"
      | "married"
      | "divorced"
      | "widowed"
      | undefined,
  };

  // ── 5. Build family.spouse ────────────────────────────────────────────────
  let spouse: IntakePayload["family"]["spouse"] = undefined;
  if (spouseContact) {
    spouse = {
      firstName: spouseContact.firstName,
      lastName: spouseContact.lastName,
      dateOfBirth: spouseContact.dateOfBirth ?? "",
      maritalStatus: (spouseContact.maritalStatus ?? undefined) as
        | "single"
        | "married"
        | "divorced"
        | "widowed"
        | undefined,
    };
  }

  // ── 6. Load children from family_members ─────────────────────────────────
  const childRows = await db
    .select()
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "child")));

  const children: IntakePayload["family"]["children"] = childRows.map((fm) => ({
    firstName: fm.firstName,
    lastName: fm.lastName ?? undefined,
    dateOfBirth: fm.dateOfBirth ?? "",
  }));

  // ── 7. Resolve base-case scenario id ─────────────────────────────────────
  // Query directly — avoids verifyClientAccess which requires Clerk auth().
  const [baseScenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  const scenarioId = baseScenario?.id ?? null;

  // ── 8. Load accounts on the base scenario ─────────────────────────────────
  const payloadAccounts: IntakePayload["accounts"] = [];
  const payloadProperty: IntakePayload["property"] = [];

  if (scenarioId) {
    const accountRows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId)));

    for (const row of accountRows) {
      if (FORM_ACCOUNT_CATEGORIES.has(row.category)) {
        payloadAccounts.push({
          name: row.name,
          category: row.category as IntakeAccountCategory,
          value: Number(row.value),
          custodian: row.custodian ?? undefined,
        });
      } else if (PROPERTY_CATEGORIES.has(row.category)) {
        payloadProperty.push({
          name: row.name,
          kind: row.category as "real_estate" | "business",
          value: Number(row.value),
        });
      }
      // stock_options and notes_receivable: DROP — no form representation.
    }

    // ── 9. Load incomes on the base scenario ──────────────────────────────
    const incomeRows = await db
      .select()
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId)));

    const payloadIncome: IntakePayload["income"] = incomeRows.map((row) => ({
      name: row.name,
      type: mapIncomeType(row.type),
      annualAmount: Number(row.annualAmount),
      owner: row.owner,
    }));

    // ── 10. Assemble and return ───────────────────────────────────────────
    return {
      family: {
        primary,
        spouse,
        stateOfResidence: stateOfResidence as string | undefined,
        children,
      },
      accounts: payloadAccounts,
      income: payloadIncome,
      property: payloadProperty,
      goals: {
        clientRetirementAge: client.retirementAge ?? undefined,
        spouseRetirementAge: client.spouseRetirementAge ?? undefined,
        // annualRetirementExpenses: sourcing would require querying the
        // "Retirement Living Expenses" default expense row — deferred; leave undefined.
      },
      meta: { completedSections: [] },
    };
  }

  // No base scenario — return the family data with empty arrays
  return {
    family: {
      primary,
      spouse,
      stateOfResidence: stateOfResidence as string | undefined,
      children,
    },
    accounts: [],
    income: [],
    property: [],
    goals: {
      clientRetirementAge: client.retirementAge ?? undefined,
      spouseRetirementAge: client.spouseRetirementAge ?? undefined,
    },
    meta: { completedSections: [] },
  };
}
