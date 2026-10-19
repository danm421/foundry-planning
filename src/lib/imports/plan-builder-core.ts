// Shared core for the Forge `build_plan` tool (modes "new" and "existing") and
// the Claude connector, which passes a `principal` (modes "new" and
// "prospect"): ensure/get the client, then create the fact finder import the
// panel attaches files to.
// The fact finder screen reads the files when the advisor opens it — this
// function's only job is to establish client + import fast and return the
// three ids the tool needs.
//
// Pure server-side lib: throws on error (client-not-found, no base scenario)
// rather than returning error strings — the B3 tool layer wraps this in
// try/catch and stringifies for the model.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholds, scenarios } from "@/db/schema";
import { verifyClientAccessAs, type Principal } from "@/lib/clients/authz";
import { findVisibleCrmHousehold, verifyCrmHouseholdAccessFor } from "@/lib/crm/authz";
import { createCrmHousehold, recordHouseholdOpen } from "@/lib/crm/households";
import { createClientForHousehold, type FilingStatus } from "@/lib/clients/create-client";
import { createFactFinderImport } from "@/lib/fact-finder/import-lifecycle";
import { isUSPSStateCode } from "@/lib/usps-states";

export interface EnsurePlanImportArgs {
  mode: "new" | "existing" | "prospect";
  firmId: string;
  actorUserId: string;
  /** The Claude connector's caller. With it the session is never read: access
   *  checks run on it and every inner create names `actorUserId` as its actor.
   *  Omitted (Forge), everything runs on the session exactly as before. */
  principal?: Principal;
  /** Stored as the import's `notes`. */
  label?: string;
  existing?: { clientId: string }; // mode "existing"
  newHousehold?: {
    // mode "new"
    householdName: string;
    state?: string | null; // USPS 2-letter; optional
    primary: { firstName: string; lastName: string; dateOfBirth: string };
    spouse?: { firstName: string; lastName: string; dateOfBirth?: string };
    filingStatus: FilingStatus;
    retirementAge: number;
    lifeExpectancy: number;
    spouseRetirementAge?: number;
    spouseLifeExpectancy?: number;
  };
  prospect?: {
    // mode "prospect": a CRM household with no plan yet
    householdId: string;
    filingStatus: FilingStatus;
    retirementAge: number;
    lifeExpectancy: number;
    spouseRetirementAge?: number;
    spouseLifeExpectancy?: number;
  };
}

export interface EnsurePlanImportResult {
  clientId: string;
  scenarioId: string;
  importId: string;
}

/** Same rule as POST /api/clients/[id]/imports: the caller (the principal when
 *  passed, else the session) must have own-firm edit access (book silo, Private
 *  clients, shares). */
async function callerMayImportInto(
  clientId: string,
  firmId: string,
  principal?: Principal,
): Promise<boolean> {
  const access = await verifyClientAccessAs(principal, clientId);
  return (
    access.ok && access.access === "own" && access.permission === "edit" && access.firmId === firmId
  );
}

/**
 * The household name of an existing client a plan import may update, or null
 * when `ensurePlanImport` would refuse that client. Forge's approval card names
 * the household with this — resolved here from the id, under the import's own
 * access rule, never taken from text the model wrote.
 */
export async function findImportTargetName(clientId: string, firmId: string): Promise<string | null> {
  if (!(await callerMayImportInto(clientId, firmId))) return null;
  const [row] = await db
    .select({ name: crmHouseholds.name })
    .from(clients)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return row?.name ?? null;
}

/** With a principal the session is never read, so each inner create is told
 *  who acts; without one it resolves the actor from the session, as before. */
function actorOf(args: EnsurePlanImportArgs): { actorId?: string } {
  return args.principal ? { actorId: args.actorUserId } : {};
}

interface CreatedPlan {
  householdId: string;
  clientId: string;
  scenarioId: string;
}

/** Mode "new": a CRM household in the actor's own book, and its plan. */
async function createNewHouseholdPlan(args: EnsurePlanImportArgs): Promise<CreatedPlan> {
  if (!args.newHousehold) throw new Error("newHousehold is required for mode \"new\".");
  const newHousehold = args.newHousehold;

  const state =
    newHousehold.state && isUSPSStateCode(newHousehold.state) ? newHousehold.state : undefined;

  const hh = await createCrmHousehold(
    {
      name: newHousehold.householdName,
      status: "prospect",
      advisorId: args.actorUserId, // server-forced; model can never widen the actor
      state,
      contacts: [
        {
          role: "primary" as const,
          firstName: newHousehold.primary.firstName,
          lastName: newHousehold.primary.lastName,
          dateOfBirth: newHousehold.primary.dateOfBirth,
        },
        ...(newHousehold.spouse
          ? [
              {
                role: "spouse" as const,
                firstName: newHousehold.spouse.firstName,
                lastName: newHousehold.spouse.lastName,
                dateOfBirth: newHousehold.spouse.dateOfBirth,
              },
            ]
          : []),
      ],
    },
    args.principal ? { firmId: args.firmId, actorId: args.actorUserId } : undefined,
  );

  const created = await createClientForHousehold({
    household: { id: hh.id, firmId: args.firmId, advisorId: args.actorUserId, state: state ?? null },
    primaryContact: {
      firstName: newHousehold.primary.firstName,
      lastName: newHousehold.primary.lastName,
      dateOfBirth: newHousehold.primary.dateOfBirth,
    },
    spouseContact: newHousehold.spouse
      ? {
          firstName: newHousehold.spouse.firstName,
          lastName: newHousehold.spouse.lastName,
          dateOfBirth: newHousehold.spouse.dateOfBirth ?? null,
        }
      : null,
    retirementAge: newHousehold.retirementAge,
    lifeExpectancy: newHousehold.lifeExpectancy,
    filingStatus: newHousehold.filingStatus,
    spouseRetirementAge: newHousehold.spouseRetirementAge,
    spouseLifeExpectancy: newHousehold.spouseLifeExpectancy,
    ...actorOf(args),
  });
  return { householdId: hh.id, ...created };
}

/** The firm of a CRM household the caller (the principal when passed, else the
 *  session) may see; null for missing and hidden alike. */
async function visibleHouseholdFirm(householdId: string, principal?: Principal): Promise<string | null> {
  if (principal) {
    const gate = await verifyCrmHouseholdAccessFor(principal, householdId);
    return gate.ok ? gate.firmId : null;
  }
  return (await findVisibleCrmHousehold(householdId))?.orgId ?? null;
}

/** Mode "prospect": a plan for an existing CRM household that has none, in that
 *  household's advisor's book (as Forge's `set_up_plan` does), so a siloed firm
 *  never hides the plan from its own advisor. */
async function createProspectPlan(args: EnsurePlanImportArgs): Promise<CreatedPlan> {
  if (!args.prospect) throw new Error("prospect is required for mode \"prospect\".");
  const prospect = args.prospect;

  // A hidden, trashed or other-firm household refuses exactly like a missing one.
  const notFound = new Error("Household not found or access denied.");
  if ((await visibleHouseholdFirm(prospect.householdId, args.principal)) !== args.firmId) throw notFound;
  const household = await db.query.crmHouseholds.findFirst({
    where: and(
      eq(crmHouseholds.id, prospect.householdId),
      eq(crmHouseholds.firmId, args.firmId),
      isNull(crmHouseholds.deletedAt),
    ),
    with: { contacts: true, planningClient: { columns: { id: true } } },
  });
  if (!household) throw notFound;
  if (household.planningClient) throw new Error("This household already has a plan.");

  const primary = household.contacts.find((c) => c.role === "primary");
  if (!primary?.dateOfBirth) throw new Error("The household's primary contact needs a date of birth.");
  const spouse = household.contacts.find((c) => c.role === "spouse");
  // A spouse on the household means createClientForHousehold would stamp its
  // retirement-age default; never guess it (Forge's `set_up_plan` refuses alike).
  // Life expectancy may take the site's default.
  if (spouse && prospect.spouseRetirementAge == null) {
    throw new Error(`${spouse.firstName}'s retirement age is required.`);
  }

  const created = await createClientForHousehold({
    household: { id: household.id, firmId: args.firmId, advisorId: household.advisorId, state: household.state },
    primaryContact: { firstName: primary.firstName, lastName: primary.lastName, dateOfBirth: primary.dateOfBirth },
    spouseContact: spouse
      ? { firstName: spouse.firstName, lastName: spouse.lastName, dateOfBirth: spouse.dateOfBirth ?? null }
      : null,
    retirementAge: prospect.retirementAge,
    lifeExpectancy: prospect.lifeExpectancy,
    filingStatus: prospect.filingStatus,
    spouseRetirementAge: prospect.spouseRetirementAge,
    spouseLifeExpectancy: prospect.spouseLifeExpectancy,
    ...actorOf(args),
  });
  return { householdId: household.id, ...created };
}

export async function ensurePlanImport(
  args: EnsurePlanImportArgs,
): Promise<EnsurePlanImportResult> {
  let clientId: string;
  let scenarioId: string;
  let mode: "onboarding" | "updating";

  if (args.mode === "existing") {
    if (!args.existing) throw new Error("existing.clientId is required for mode \"existing\".");

    // Checked here so no caller can skip it.
    if (!(await callerMayImportInto(args.existing.clientId, args.firmId, args.principal))) {
      throw new Error("Client not found or access denied.");
    }

    // Verify the client belongs to the firm before any insert — never trust
    // the passed clientId blindly.
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, args.existing.clientId), eq(clients.firmId, args.firmId)));
    if (!client) throw new Error("Client not found for this firm.");

    const [base] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, args.existing.clientId), eq(scenarios.isBaseCase, true)));
    if (!base) throw new Error("Client has no base scenario.");

    clientId = args.existing.clientId;
    scenarioId = base.id;
    mode = "updating";
  } else {
    const created =
      args.mode === "prospect" ? await createProspectPlan(args) : await createNewHouseholdPlan(args);
    clientId = created.clientId;
    scenarioId = created.scenarioId;
    mode = "onboarding";

    // Surface the household in the advisor's "Recently opened" clients list,
    // as POST /api/clients does for the form-driven create. Non-fatal: a
    // view-write failure must not fail the plan build.
    try {
      await recordHouseholdOpen(created.householdId, args.actorUserId, args.principal);
    } catch (viewErr) {
      console.error("Failed to record household open on plan build:", viewErr);
    }
  }

  const imp = await createFactFinderImport({
    clientId,
    firmId: args.firmId,
    userId: args.actorUserId,
    scenarioId,
    mode,
    notes: args.label,
    audit: { planBuilder: true },
  });

  return { clientId, scenarioId, importId: imp.id };
}
