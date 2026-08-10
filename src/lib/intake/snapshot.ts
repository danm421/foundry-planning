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
  accountOwners,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  familyMembers,
  scenarios,
  accounts,
  incomes,
  liabilities,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { IntakePayload } from "@/lib/intake/schema";
import {
  INTAKE_ACCOUNT_CATEGORY_VALUES,
  isSubTypeOfCategory,
  type IntakeAccountCategory,
  type IntakeAccountSubType,
} from "@/lib/intake/account-types";
import type { IntakeSectionKey } from "@/lib/intake/sections";
import { incomeFormYears } from "@/lib/intake/income-years";

// ── DB → form category mapping ────────────────────────────────────────────────
//
// DB accountCategoryEnum has 10 members; the form accepts 6 (see
// `account-types.ts`, which is also what the Accounts step renders).
//
// | DB category       | Form disposition                          |
// |-------------------|-------------------------------------------|
// | taxable           | pass-through → accounts.category          |
// | cash              | pass-through → accounts.category          |
// | retirement        | pass-through → accounts.category          |
// | education_savings | pass-through → accounts.category          |
// | annuity           | pass-through → accounts.category          |
// | life_insurance    | pass-through → accounts.category          |
// | real_estate       | emit as property entry (kind=real_estate)  |
// | business          | emit as property entry (kind=business)     |
// | stock_options     | DROP — no form representation             |
// | notes_receivable  | DROP — no form representation             |

const FORM_ACCOUNT_CATEGORIES = new Set<string>(INTAKE_ACCOUNT_CATEGORY_VALUES);

const PROPERTY_CATEGORIES = new Set<string>(["real_estate", "business"]);

// ── Income type mapping ───────────────────────────────────────────────────────
//
// DB incomeTypeEnum: salary | social_security | business | deferred |
//                   capital_gains | trust | other
// Form income types: salary | social_security | business | other
// Mapping: DB "deferred" | "capital_gains" | "trust" → form "other"

type IntakeIncomeType = "salary" | "social_security" | "business" | "other";

// ── Account ownership → the form's coarse owner enum ─────────────────────────
//
// account_owners is polymorphic (family member / entity / external beneficiary)
// and percent-weighted; the form offers only client | spouse | joint. Entity-
// and beneficiary-owned accounts have no household role, so they fall back to
// "client" — the same default the form itself uses.

type IntakeOwner = "client" | "spouse" | "joint";

async function loadAccountOwners(clientId: string): Promise<Map<string, IntakeOwner>> {
  const rows = await db
    .select({ accountId: accountOwners.accountId, role: familyMembers.role })
    .from(accountOwners)
    .innerJoin(familyMembers, eq(accountOwners.familyMemberId, familyMembers.id))
    .where(eq(familyMembers.clientId, clientId));

  const roles = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = roles.get(row.accountId) ?? new Set<string>();
    set.add(row.role);
    roles.set(row.accountId, set);
  }

  const owners = new Map<string, IntakeOwner>();
  for (const [accountId, set] of roles) {
    const hasClient = set.has("client");
    const hasSpouse = set.has("spouse");
    owners.set(
      accountId,
      hasClient && hasSpouse ? "joint" : hasSpouse ? "spouse" : "client",
    );
  }
  return owners;
}

// ── Mortgages → the form's property.mortgage sub-object ──────────────────────
//
// Only liabilities linked to a property come back: an unlinked debt (a car
// loan, a card) has no property row to hang off, and the form has no other
// place to put it.
//
// Years remaining is derived, not stored — the row carries an origination year
// plus a full term, and the form asks how long is left. Anything already paid
// off comes back as 0 rather than a negative.

type IntakeMortgage = NonNullable<IntakePayload["property"][number]["mortgage"]>;

async function loadMortgagesByPropertyId(
  clientId: string,
  scenarioId: string,
): Promise<Map<string, IntakeMortgage>> {
  const rows = await db
    .select()
    .from(liabilities)
    .where(
      and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenarioId)),
    );

  const now = new Date();
  const elapsedMonthsFrom = (startYear: number, startMonth: number) =>
    (now.getFullYear() - startYear) * 12 + (now.getMonth() + 1 - startMonth);

  const byProperty = new Map<string, IntakeMortgage>();
  for (const row of rows) {
    if (!row.linkedPropertyId) continue;
    // One mortgage per property in the form's shape; keep the first.
    if (byProperty.has(row.linkedPropertyId)) continue;
    const monthsLeft = Math.max(
      0,
      (row.termMonths ?? 0) - elapsedMonthsFrom(row.startYear, row.startMonth),
    );
    byProperty.set(row.linkedPropertyId, {
      balance: Number(row.balance),
      yearsRemaining: Math.round((monthsLeft / 12) * 10) / 10,
      // The column stores a decimal fraction; the form asks for a percent.
      interestRatePct: Math.round(Number(row.interestRate) * 10000) / 100,
      monthlyPayment: Number(row.monthlyPayment ?? 0),
    });
  }
  return byProperty;
}

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
  // Seeding a section the form does not collect would put data in the payload
  // that the client never sees and apply never writes — dead weight at best,
  // and a stale-data hazard if the apply gate ever regresses.
  //
  // REQUIRED, deliberately. A default here reads as harmless and isn't: it lets
  // a caller that forgot to thread the form's sections through compile clean and
  // silently snapshot everything. Callers pass `sectionsForForm(form.sections)`.
  sections: readonly IntakeSectionKey[],
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
  // `family` is optional on IntakePayload (a form that does not collect it omits
  // the key entirely), so the slice types have to unwrap that optionality.
  type IntakeFamily = NonNullable<IntakePayload["family"]>;

  const primary: IntakeFamily["primary"] = {
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
  let spouse: IntakeFamily["spouse"] = undefined;
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

  const children: IntakeFamily["children"] = childRows.map((fm) => ({
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

    const ownerByAccountId = await loadAccountOwners(clientId);
    const mortgageByPropertyId = await loadMortgagesByPropertyId(clientId, scenarioId);

    for (const row of accountRows) {
      if (FORM_ACCOUNT_CATEGORIES.has(row.category)) {
        const category = row.category as IntakeAccountCategory;
        payloadAccounts.push({
          name: row.name,
          category,
          // Only a sub-type this category actually offers survives: the DB's
          // enum is wider than the form's picker (a Plaid-imported "hsa" on a
          // cash account, say), and a pair the picker can't render is a pair
          // the submit schema rejects. Dropping it re-seeds the default.
          subType: isSubTypeOfCategory(category, row.subType)
            ? (row.subType as IntakeAccountSubType)
            : undefined,
          value: Number(row.value),
          basis: Number(row.basis),
          owner: ownerByAccountId.get(row.id) ?? "client",
          custodian: row.custodian ?? undefined,
        });
      } else if (PROPERTY_CATEGORIES.has(row.category)) {
        payloadProperty.push({
          name: row.name,
          kind: row.category as "real_estate" | "business",
          value: Number(row.value),
          basis: Number(row.basis),
          owner: ownerByAccountId.get(row.id) ?? "client",
          annualPropertyTax: Number(row.annualPropertyTax),
          mortgage: mortgageByPropertyId.get(row.id),
          // annualInsurance is deliberately absent: unlike property tax it has
          // no column, so recovering it would mean name-matching the expense
          // row apply wrote — too fragile to round-trip. The client re-enters
          // it, and the advisor sees it on the review diff either way.
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
      ...incomeFormYears(row),
    }));

    // ── 10. Assemble and return ───────────────────────────────────────────
    // Each slice is seeded only when the form collects it. `goals` stays
    // populated regardless: it carries clientRetirementAge / spouseRetirementAge,
    // which the wizard's Income step reads for its retirement anchor even when
    // the Goals step itself is excluded.
    return {
      ...(sections.includes("family")
        ? {
            family: {
              primary,
              spouse,
              stateOfResidence: stateOfResidence as string | undefined,
              children,
            },
          }
        : {}),
      accounts: sections.includes("accounts") ? payloadAccounts : [],
      income: sections.includes("income") ? payloadIncome : [],
      property: sections.includes("property") ? payloadProperty : [],
      goals: {
        clientRetirementAge: client.retirementAge ?? undefined,
        spouseRetirementAge: client.spouseRetirementAge ?? undefined,
        // annualRetirementExpenses: sourcing would require querying the
        // "Retirement Living Expenses" default expense row — deferred; leave undefined.
        //
        // expenseGoals / topics: not sourced either, for the same reason plus a
        // lossy one — the form's seven goal types all collapse to "other" in the
        // DB, so a round-trip would relabel a client's wedding as "Something
        // else". A prefilled form starts these sections empty; the advisor sees
        // whatever the client enters on the review diff regardless.
        expenseGoals: [],
        topics: [],
      },
      meta: { completedSections: [] },
    };
  }

  // No base scenario — return the family data with empty arrays
  return {
    ...(sections.includes("family")
      ? {
          family: {
            primary,
            spouse,
            stateOfResidence: stateOfResidence as string | undefined,
            children,
          },
        }
      : {}),
    accounts: [],
    income: [],
    property: [],
    goals: {
      clientRetirementAge: client.retirementAge ?? undefined,
      spouseRetirementAge: client.spouseRetirementAge ?? undefined,
      expenseGoals: [],
      topics: [],
    },
    meta: { completedSections: [] },
  };
}
