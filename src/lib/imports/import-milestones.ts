import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clients, crmHouseholdContacts, planSettings, scenarios } from "@/db/schema";
import { buildClientMilestones, type ClientMilestones } from "@/lib/milestones";

export interface ImportMilestones {
  milestones: ClientMilestones;
  clientFirstName: string;
  spouseFirstName?: string;
}

interface ContactLite {
  firstName: string;
  dateOfBirth: string | null;
}

interface AssembleInput {
  retirementAge: number;
  planEndAge: number;
  spouseRetirementAge: number | null;
  primary: ContactLite | undefined;
  spouse: ContactLite | undefined;
  planStartYear: number | null;
  planEndYear: number | null;
}

/**
 * Pure assembly of ClientMilestones from the pieces the import flow can
 * load. Returns null when the primary contact has no DOB — callers then
 * fall back to manual year entry (UI) or drop refs (commit).
 */
export function assembleImportMilestones(input: AssembleInput): ImportMilestones | null {
  if (!input.primary?.dateOfBirth) return null;
  const currentYear = new Date().getFullYear();
  const planStart = input.planStartYear ?? currentYear;
  const planEnd = input.planEndYear ?? currentYear + 30;

  const milestones = buildClientMilestones(
    {
      dateOfBirth: input.primary.dateOfBirth,
      retirementAge: input.retirementAge,
      planEndAge: input.planEndAge,
      spouseDob: input.spouse?.dateOfBirth ?? null,
      spouseRetirementAge: input.spouseRetirementAge,
    },
    planStart,
    planEnd,
  );

  return {
    milestones,
    clientFirstName: input.primary.firstName,
    spouseFirstName: input.spouse?.firstName,
  };
}

/**
 * Load the client + CRM contacts + plan settings and assemble milestones
 * for the import flow. scenarioId may be null (onboarding) — we resolve the
 * base-case scenario for plan settings. Returns null when milestones can't
 * be built (no DOB yet) so callers degrade gracefully.
 */
export async function loadImportMilestones(
  clientId: string,
  firmId: string,
  scenarioId: string | null,
): Promise<ImportMilestones | null> {
  const [clientRow] = await db
    .select({
      retirementAge: clients.retirementAge,
      planEndAge: clients.planEndAge,
      spouseRetirementAge: clients.spouseRetirementAge,
      crmHouseholdId: clients.crmHouseholdId,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!clientRow) return null;

  const contacts = await db
    .select({
      role: crmHouseholdContacts.role,
      firstName: crmHouseholdContacts.firstName,
      dateOfBirth: crmHouseholdContacts.dateOfBirth,
    })
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primary = contacts.find((c) => c.role === "primary");
  const spouse = contacts.find((c) => c.role === "spouse");

  let sid = scenarioId;
  if (!sid) {
    const [baseScenario] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
    sid = baseScenario?.id ?? null;
  }

  let settings: { planStartYear: number; planEndYear: number } | undefined;
  if (sid) {
    [settings] = await db
      .select({ planStartYear: planSettings.planStartYear, planEndYear: planSettings.planEndYear })
      .from(planSettings)
      .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, sid)));
  }

  return assembleImportMilestones({
    retirementAge: clientRow.retirementAge,
    planEndAge: clientRow.planEndAge,
    spouseRetirementAge: clientRow.spouseRetirementAge,
    primary: primary ? { firstName: primary.firstName, dateOfBirth: primary.dateOfBirth } : undefined,
    spouse: spouse ? { firstName: spouse.firstName, dateOfBirth: spouse.dateOfBirth } : undefined,
    planStartYear: settings?.planStartYear ?? null,
    planEndYear: settings?.planEndYear ?? null,
  });
}
