import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import ClientsTable from "@/components/clients-table";

export async function ClientsContent({ firmId }: { firmId: string }) {
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.firmId, firmId));

  // CRM contacts — sole identity source. Single query scoped to the households
  // this firm's clients are linked to.
  const householdIds = rows.map((c) => c.crmHouseholdId);
  const contactRows = householdIds.length
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(inArray(crmHouseholdContacts.householdId, householdIds))
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
  // Drop rows missing a primary CRM contact — they're inactive/orphaned.
  const serialized = rows
    .map((c) => {
      const ctx = householdContacts.get(c.crmHouseholdId);
      const primary = ctx?.primary ?? null;
      const spouse = ctx?.spouse ?? null;
      if (!primary) return null;
      return {
        id: c.id,
        firstName: primary.firstName,
        lastName: primary.lastName,
        dateOfBirth: primary.dateOfBirth ?? "",
        retirementAge: c.retirementAge,
        planEndAge: c.planEndAge,
        filingStatus: c.filingStatus,
        spouseName: spouse?.firstName ?? null,
        spouseLastName: spouse?.lastName ?? null,
        spouseDob: spouse?.dateOfBirth ?? null,
        spouseRetirementAge: c.spouseRetirementAge ?? null,
        email: primary.email ?? null,
        phone: primary.phone ?? null,
        mobile: primary.mobile ?? null,
        addressLine1: primary.addressLine1 ?? null,
        addressLine2: primary.addressLine2 ?? null,
        city: primary.city ?? null,
        state: primary.state ?? null,
        postalCode: primary.postalCode ?? null,
        country: primary.country ?? null,
        spouseEmail: spouse?.email ?? null,
        spousePhone: spouse?.phone ?? null,
        spouseMobile: spouse?.mobile ?? null,
        spouseAddressLine1: spouse?.addressLine1 ?? null,
        spouseAddressLine2: spouse?.addressLine2 ?? null,
        spouseCity: spouse?.city ?? null,
        spouseState: spouse?.state ?? null,
        spousePostalCode: spouse?.postalCode ?? null,
        spouseCountry: spouse?.country ?? null,
        createdAt:
          c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
        updatedAt:
          c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => {
      const last = a.lastName.localeCompare(b.lastName);
      return last !== 0 ? last : a.firstName.localeCompare(b.firstName);
    });

  return <ClientsTable rows={serialized} />;
}
