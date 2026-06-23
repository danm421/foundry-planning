import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts,
  expenses,
  incomes,
  familyMembers,
} from "@/db/schema";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { recordAudit } from "@/lib/audit";
import { isUSPSStateCode } from "@/lib/usps-states";

// Drizzle transaction handle — same convention used in
// src/lib/clients/mirror-contact-to-crm.ts and src/lib/ownership.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Either the top-level db or a transaction handle. The service runs all its
// inserts on whichever it's handed; when no caller-supplied tx is provided it
// opens its own transaction so the standalone path is fully atomic.
type DbOrTx = typeof db | Tx;

export type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_of_household";

export interface CreateClientForHouseholdArgs {
  household: {
    id: string;
    firmId: string;
    advisorId: string;
    state: string | null;
  };
  primaryContact: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  spouseContact?: {
    firstName: string;
    lastName: string;
    // May be null — a spouse contact can exist without a DOB on file. The
    // create logic feeds null straight into computePlanEndAge / the family row.
    dateOfBirth: string | null;
  } | null;
  retirementAge: number;
  retirementMonth?: number;
  lifeExpectancy: number;
  spouseRetirementAge?: number | null;
  spouseRetirementMonth?: number | null;
  spouseLifeExpectancy?: number | null;
  filingStatus: FilingStatus;
  // Optional caller-supplied transaction handle (the prospect-apply path runs
  // this create inside a larger transaction). When omitted, the service wraps
  // all its inserts in its own db.transaction so the standalone path is atomic.
  tx?: Tx;
}

export interface CreateClientForHouseholdResult {
  clientId: string;
  scenarioId: string;
}

// All inserts run against the supplied handle (db or tx). Splitting this out
// lets the public function decide whether to open its own transaction.
async function runCreate(
  handle: DbOrTx,
  args: CreateClientForHouseholdArgs,
): Promise<CreateClientForHouseholdResult> {
  const {
    household,
    primaryContact,
    spouseContact,
    retirementAge,
    retirementMonth,
    lifeExpectancy,
    spouseRetirementAge,
    spouseRetirementMonth,
    spouseLifeExpectancy,
    filingStatus,
  } = args;

  const firstName = primaryContact.firstName;
  const lastName = primaryContact.lastName;
  const dateOfBirth = primaryContact.dateOfBirth;
  const spouseName = spouseContact?.firstName ?? null;
  const spouseLastName = spouseContact?.lastName ?? null;
  const spouseDob = spouseContact?.dateOfBirth ?? null;

  // When the household has a spouse, their planning fields must never be blank
  // — default retirement to 65 and life expectancy to 95. Some creation paths
  // (e.g. AI import) never surface these inputs, so we default here at the
  // single write chokepoint rather than in each form. No spouse → stay null.
  const hasSpouse = spouseContact != null;
  const effectiveSpouseRetirementAge = hasSpouse
    ? Number(spouseRetirementAge ?? 65)
    : null;
  const effectiveSpouseRetirementMonth = hasSpouse
    ? Number(spouseRetirementMonth ?? 1)
    : null;
  const effectiveSpouseLifeExpectancy = hasSpouse
    ? Number(spouseLifeExpectancy ?? 95)
    : null;

  // Plan horizon is the year the last spouse dies; plan_end_age is derived
  // from client + spouse life expectancies.
  const planEndAge = computePlanEndAge({
    clientDob: dateOfBirth,
    clientLifeExpectancy: Number(lifeExpectancy),
    spouseDob: spouseDob ?? null,
    spouseLifeExpectancy: effectiveSpouseLifeExpectancy,
  });

  const currentYear = new Date().getFullYear();

  // Insert client — identity lives on CRM contacts (linked via crmHouseholdId),
  // so the clients row only carries planning fields.
  const [client] = await handle
    .insert(clients)
    .values({
      firmId: household.firmId,
      advisorId: household.advisorId,
      crmHouseholdId: household.id,
      retirementAge: Number(retirementAge),
      retirementMonth: retirementMonth != null ? Number(retirementMonth) : 1,
      planEndAge,
      lifeExpectancy: Number(lifeExpectancy),
      filingStatus,
      spouseRetirementAge: effectiveSpouseRetirementAge,
      spouseRetirementMonth: effectiveSpouseRetirementMonth,
      spouseLifeExpectancy: effectiveSpouseLifeExpectancy,
    })
    .returning();

  // Insert base case scenario
  const [scenario] = await handle
    .insert(scenarios)
    .values({
      clientId: client.id,
      name: "Base Case",
      isBaseCase: true,
    })
    .returning();

  // Insert default plan settings
  await handle.insert(planSettings).values({
    clientId: client.id,
    scenarioId: scenario.id,
    planStartYear: currentYear,
    planEndYear: new Date(dateOfBirth).getFullYear() + planEndAge,
    // Seed the plan's residence state from the household's canonical state so
    // state income + estate tax compute on real brackets instead of the flat
    // fallback. Seed-once: the assumptions page owns residenceState per
    // scenario after this; later household-state edits don't re-propagate.
    residenceState: isUSPSStateCode(household.state) ? household.state : null,
  });

  // Seed household family_members rows (role='client', and 'spouse' if married).
  // OwnershipEditor's preset buttons and defaultOwners both key off these rows;
  // without them, every newly-added account is rejected with
  // "owners must have at least one entry". The relationship enum doesn't have
  // 'client'/'spouse' values, so we use 'other' as a placeholder — the role
  // column is what the UI keys off.
  const familyRows: Array<typeof familyMembers.$inferInsert> = [
    {
      clientId: client.id,
      role: "client",
      relationship: "other",
      firstName,
      lastName,
      dateOfBirth,
    },
  ];
  if (spouseName) {
    familyRows.push({
      clientId: client.id,
      role: "spouse",
      relationship: "other",
      firstName: spouseName,
      lastName: spouseLastName ?? lastName,
      dateOfBirth: spouseDob ?? null,
    });
  }
  await handle.insert(familyMembers).values(familyRows);

  // Insert default household cash account. Household income lands here and expenses
  // are drawn from it; the projection engine pulls from the withdrawal strategy when
  // this balance would go negative.
  // Insert default household cash account. No account_owners rows are created here;
  // joint FM ownership is inferred when family members are added via the family page.
  await handle.insert(accounts).values({
    clientId: client.id,
    scenarioId: scenario.id,
    name: "Household Cash",
    category: "cash",
    subType: "checking",
    value: "0",
    basis: "0",
    // null -> inherit the cash category default from plan_settings
    growthRate: null,
    rmdEnabled: false,
    isDefaultChecking: true,
  });

  // Seed two living-expense rows at $0 so the advisor has an obvious prompt to
  // fill in pre- and post-retirement spending. The retirement row is entered in
  // today's dollars so inflation compounds from plan start through retirement.
  const clientBirthYear = new Date(dateOfBirth).getFullYear();
  const retirementStartYear = clientBirthYear + Number(retirementAge);
  const planEndYearValue = clientBirthYear + Number(planEndAge);
  // Living expenses are anchored to milestones so they track changes to
  // retirement age and plan horizon: current-living runs plan_start →
  // client_retirement, retirement-living runs client_retirement → plan_end.
  const expenseSeeds = [
    {
      name: "Current Living Expenses",
      startYear: currentYear,
      startYearRef: "plan_start" as const,
      endYear: Math.max(currentYear, retirementStartYear),
      endYearRef: "client_retirement" as const,
      inflationStartYear: null as number | null,
    },
    {
      name: "Retirement Living Expenses",
      startYear: retirementStartYear,
      startYearRef: "client_retirement" as const,
      endYear: planEndYearValue,
      endYearRef: "plan_end" as const,
      inflationStartYear: currentYear,
    },
  ];
  await handle.insert(expenses).values(
    expenseSeeds.map((seed) => ({
      clientId: client.id,
      scenarioId: scenario.id,
      type: "living" as const,
      name: seed.name,
      annualAmount: "0",
      startYear: seed.startYear,
      startYearRef: seed.startYearRef,
      endYear: seed.endYear,
      endYearRef: seed.endYearRef,
      growthRate: "0.03",
      inflationStartYear: seed.inflationStartYear,
      isDefault: true,
    })),
  );

  // Seed Social Security income entries at $0 — one per person on the household —
  // so the advisor is prompted to enter benefit amounts and claiming ages.
  const ssSeeds: { name: string; owner: "client" | "spouse" }[] = [
    { name: `Social Security — ${firstName}`, owner: "client" },
  ];
  if (spouseName) {
    ssSeeds.push({ name: `Social Security — ${spouseName}`, owner: "spouse" });
  }
  await handle.insert(incomes).values(
    ssSeeds.map((seed) => ({
      clientId: client.id,
      scenarioId: scenario.id,
      type: "social_security" as const,
      name: seed.name,
      annualAmount: "0",
      startYear: currentYear,
      endYear: planEndYearValue,
      growthRate: "0.02",
      owner: seed.owner,
      claimingAge: 67,
    })),
  );

  // Record the client.create audit. Mirror the original route: pass NO explicit
  // actorId so recordAudit self-resolves the actor via Clerk auth() — preserving
  // ops-impersonation attribution (the ops operator is recorded as the actor with
  // an actingAsAdvisor stamp). Best-effort/append-only: runs on the global db
  // path, outside the create transaction, exactly as before.
  await recordAudit({
    action: "client.create",
    resourceType: "client",
    resourceId: client.id,
    clientId: client.id,
    firmId: household.firmId,
    metadata: { firstName, lastName, crmHouseholdId: household.id },
  });

  return { clientId: client.id, scenarioId: scenario.id };
}

/**
 * Creates a full planning client for a CRM household: the `clients` row, a Base
 * Case `scenarios` row, default `planSettings`, `familyMembers` (client + spouse
 * when married), the default "Household Cash" checking account, two default
 * "living" expense rows, and Social Security `incomes` rows. Always records the
 * `client.create` audit, self-resolving the actor via Clerk `auth()` (preserving
 * ops-impersonation attribution) — matching the original route behavior.
 *
 * Shared between POST /api/clients and the prospect-apply path so both create a
 * client through one implementation. Pre-flight (household load, primary-DOB
 * 422, contact mirroring, recordHouseholdOpen) stays at the call site.
 *
 * Atomicity: when a `tx` is supplied, all inserts run on that handle (no nested
 * transaction). When omitted, the service wraps every insert in its own
 * `db.transaction` so the standalone create is fully atomic.
 */
export async function createClientForHousehold(
  args: CreateClientForHouseholdArgs,
): Promise<CreateClientForHouseholdResult> {
  if (args.tx) {
    return runCreate(args.tx, args);
  }
  return db.transaction((tx) => runCreate(tx, args));
}
