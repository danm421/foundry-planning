import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import ClientsTable from "@/components/clients-table";

export async function ClientsContent({ firmId }: { firmId: string }) {
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.firmId, firmId))
    .orderBy(asc(clients.lastName), asc(clients.firstName));

  // CRM contacts — identity source. Single query, scoped to households this
  // firm's clients are linked to.
  const householdIds = rows
    .map((c) => c.crmHouseholdId)
    .filter((id): id is string => id != null);
  const contactRows = householdIds.length
    ? await db.select().from(crmHouseholdContacts)
    : [];
  const householdContacts = new Map<
    string,
    { primary: typeof contactRows[number] | null; spouse: typeof contactRows[number] | null }
  >();
  for (const contact of contactRows) {
    const entry = householdContacts.get(contact.householdId) ?? { primary: null, spouse: null };
    if (contact.role === "primary") entry.primary = contact;
    else if (contact.role === "spouse") entry.spouse = contact;
    householdContacts.set(contact.householdId, entry);
  }

  // Serialize dates to strings so they pass cleanly to the client component.
  const serialized = rows.map((c) => {
    const ctx = c.crmHouseholdId ? householdContacts.get(c.crmHouseholdId) : undefined;
    const primary = ctx?.primary ?? null;
    const spouse = ctx?.spouse ?? null;
    return {
      id: c.id,
      firstName: primary?.firstName ?? c.firstName,
      lastName: primary?.lastName ?? c.lastName,
      dateOfBirth: primary?.dateOfBirth ?? c.dateOfBirth,
      retirementAge: c.retirementAge,
      planEndAge: c.planEndAge,
      filingStatus: c.filingStatus,
      spouseName: spouse?.firstName ?? c.spouseName ?? null,
      spouseLastName: spouse?.lastName ?? c.spouseLastName ?? null,
      spouseDob: spouse?.dateOfBirth ?? c.spouseDob ?? null,
      spouseRetirementAge: c.spouseRetirementAge ?? null,
      email: primary?.email ?? c.email ?? null,
      address: primary?.addressLine1 ?? c.address ?? null,
      spouseEmail: spouse?.email ?? c.spouseEmail ?? null,
      spouseAddress: spouse?.addressLine1 ?? c.spouseAddress ?? null,
      createdAt:
        c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
      updatedAt:
        c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
    };
  });

  return <ClientsTable rows={serialized} />;
}
