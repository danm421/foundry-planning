// src/lib/quick-start/load-identity.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";

export interface QsIdentity {
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  spouseDob: string | null;
  spouseRetirementAge: number | null;
  clientFirstName: string;
  spouseFirstName: string | null;
  hasSpouse: boolean;
}

/**
 * Resolves the names/DOBs/retirement ages the wizard needs to derive milestones.
 * Identity (names, DOB) lives on the CRM household contacts; plan ages live on `clients`.
 */
export async function loadClientIdentity(clientId: string): Promise<QsIdentity> {
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
  const contacts = c?.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, c.crmHouseholdId))
    : [];
  const primary = contacts.find((x) => x.role === "primary") ?? null;
  const spouse = contacts.find((x) => x.role === "spouse") ?? null;
  return {
    dateOfBirth: primary?.dateOfBirth ?? "",
    retirementAge: c?.retirementAge ?? 65,
    planEndAge: c?.planEndAge ?? 95,
    spouseDob: spouse?.dateOfBirth ?? null,
    spouseRetirementAge: c?.spouseRetirementAge ?? null,
    clientFirstName: primary?.firstName ?? "Client",
    spouseFirstName: spouse?.firstName ?? null,
    hasSpouse: Boolean(spouse),
  };
}
