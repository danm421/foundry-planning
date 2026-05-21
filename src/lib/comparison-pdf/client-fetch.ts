import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";

export interface ClientForExport {
  id: string;
  firmId: string;
  advisorId: string;
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export async function clientByIdInFirm(
  clientId: string,
  firmId: string,
): Promise<ClientForExport | null> {
  const [row] = await db
    .select({
      id: clients.id,
      firmId: clients.firmId,
      advisorId: clients.advisorId,
      legacyFirstName: clients.firstName,
      legacyLastName: clients.lastName,
      legacySpouseName: clients.spouseName,
      legacySpouseLastName: clients.spouseLastName,
      crmHouseholdId: clients.crmHouseholdId,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!row) return null;

  const contacts = row.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, row.crmHouseholdId))
    : [];
  const primary = contacts.find((c) => c.role === "primary") ?? null;
  const spouse = contacts.find((c) => c.role === "spouse") ?? null;

  return {
    id: row.id,
    firmId: row.firmId,
    advisorId: row.advisorId,
    firstName: primary?.firstName ?? row.legacyFirstName,
    lastName: primary?.lastName ?? row.legacyLastName,
    spouseName: spouse?.firstName ?? row.legacySpouseName,
    spouseLastName: spouse?.lastName ?? row.legacySpouseLastName,
  };
}

export async function resolveAdvisorName(advisorId: string): Promise<string> {
  try {
    const cc = await clerkClient();
    const advisor = await cc.users.getUser(advisorId);
    const fullName = [advisor.firstName, advisor.lastName].filter(Boolean).join(" ").trim();
    return fullName || advisor.emailAddresses?.[0]?.emailAddress || "Advisor";
  } catch {
    return "Advisor";
  }
}
