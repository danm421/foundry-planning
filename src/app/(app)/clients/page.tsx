import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import ClientsTable from "@/components/clients-table";

export default async function ClientsPage() {
  const firmId = await getOrgId();

  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.firmId, firmId))
    .orderBy(asc(clients.lastName), asc(clients.firstName));

  // Serialize dates to strings so they pass cleanly to the client component.
  const serialized = rows.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: c.dateOfBirth,
    retirementAge: c.retirementAge,
    planEndAge: c.planEndAge,
    filingStatus: c.filingStatus,
    spouseName: c.spouseName ?? null,
    spouseLastName: c.spouseLastName ?? null,
    spouseDob: c.spouseDob ?? null,
    spouseRetirementAge: c.spouseRetirementAge ?? null,
    email: c.email ?? null,
    address: c.address ?? null,
    spouseEmail: c.spouseEmail ?? null,
    spouseAddress: c.spouseAddress ?? null,
    createdAt:
      c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    updatedAt:
      c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
  }));

  return <ClientsTable rows={serialized} />;
}
