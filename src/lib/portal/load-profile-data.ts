// src/lib/portal/load-profile-data.ts
//
// Server loaders for the portal Profile screens (Household, Family, Trusts).
// Verbatim ports of the query sections in:
//   - src/components/portal/household-section.tsx:14-39
//   - src/components/portal/family-section.tsx:14-29
//   - src/components/portal/trusts-section.tsx:14-28
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, entities, familyMembers } from "@/db/schema";
import type {
  PortalContactDTO,
  PortalFamilyMemberDTO,
  PortalHouseholdDTO,
  PortalTrustDTO,
} from "./contracts";

type ContactRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

function toContact(row: ContactRow | undefined): PortalContactDTO | null {
  if (!row) return null;
  const { id, firstName, lastName, email, phone } = row;
  return { id, firstName, lastName, email, phone };
}

export async function loadPortalHousehold(clientId: string): Promise<PortalHouseholdDTO | null> {
  const [client] = await db
    .select({
      crmHouseholdId: clients.crmHouseholdId,
      filingStatus: clients.filingStatus,
      lifeExpectancy: clients.lifeExpectancy,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const contacts = client.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId))
    : [];

  return {
    filingStatus: client.filingStatus,
    lifeExpectancy: client.lifeExpectancy,
    primary: toContact(contacts.find((c) => c.role === "primary")),
    spouse: toContact(contacts.find((c) => c.role === "spouse")),
  };
}

export async function loadPortalFamily(clientId: string): Promise<PortalFamilyMemberDTO[]> {
  return db
    .select({
      id: familyMembers.id,
      firstName: familyMembers.firstName,
      lastName: familyMembers.lastName,
      relationship: familyMembers.relationship,
      dateOfBirth: familyMembers.dateOfBirth,
    })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId));
}

export async function loadPortalTrusts(clientId: string): Promise<PortalTrustDTO[]> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      value: entities.value,
      isGrantor: entities.isGrantor,
    })
    .from(entities)
    .where(and(eq(entities.clientId, clientId), eq(entities.entityType, "trust")));
  return rows.map((r) => ({ ...r, value: Number(r.value) }));
}
