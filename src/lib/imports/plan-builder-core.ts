// Shared core for the Forge `build_plan` tool (both modes): ensure/get the
// client, then create the `clientImports` row the panel attaches files to.
// Assemble runs later (after files land, via the A6 route) — this function's
// only job is to establish client + import fast and return the three ids the
// tool needs.
//
// Pure server-side lib: throws on error (client-not-found, no base scenario)
// rather than returning error strings — the B3 tool layer wraps this in
// try/catch and stringifies for the model.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, scenarios, clientImports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { createCrmHousehold } from "@/lib/crm/households";
import { createClientForHousehold, type FilingStatus } from "@/lib/clients/create-client";
import { isUSPSStateCode } from "@/lib/usps-states";

export interface EnsurePlanImportArgs {
  mode: "new" | "existing";
  firmId: string;
  actorUserId: string;
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
}

export interface EnsurePlanImportResult {
  clientId: string;
  scenarioId: string;
  importId: string;
}

export async function ensurePlanImport(
  args: EnsurePlanImportArgs,
): Promise<EnsurePlanImportResult> {
  let clientId: string;
  let scenarioId: string;
  let mode: "onboarding" | "updating";

  if (args.mode === "existing") {
    if (!args.existing) throw new Error("existing.clientId is required for mode \"existing\".");

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
    if (!args.newHousehold) throw new Error("newHousehold is required for mode \"new\".");
    const newHousehold = args.newHousehold;

    const state =
      newHousehold.state && isUSPSStateCode(newHousehold.state) ? newHousehold.state : undefined;

    const hh = await createCrmHousehold({
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
    });

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
    });

    clientId = created.clientId;
    scenarioId = created.scenarioId;
    mode = "onboarding";
  }

  // Shared insert — mirror src/app/api/clients/[id]/imports/route.ts:143-166.
  // `origin` is deliberately omitted: it defaults to "extraction" in the schema.
  const [imp] = await db
    .insert(clientImports)
    .values({
      clientId,
      orgId: args.firmId,
      scenarioId,
      mode,
      status: "draft",
      createdByUserId: args.actorUserId,
    })
    .returning();

  await recordAudit({
    action: "import.created",
    resourceType: "client_import",
    resourceId: imp.id,
    clientId,
    firmId: args.firmId,
    actorId: args.actorUserId,
    metadata: { mode, scenarioId, planBuilder: true },
  });

  return { clientId, scenarioId, importId: imp.id };
}
