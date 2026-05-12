import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import EstateTaxTabbedView from "@/components/estate-tax-tabbed-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EstateTaxReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    // Parent layout already handles the 404 case via notFound(); this is a
    // belt-and-suspenders fallback if scope ever drifts.
    notFound();
  }

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  const ownerNames = {
    clientName: client.firstName ?? "Client",
    spouseName: client.spouseName ?? null,
  };

  const ownerDobs = {
    clientDob: client.dateOfBirth,
    spouseDob: client.spouseDob ?? null,
  };

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const clientRetirementYear = clientBirthYear + client.retirementAge;
  const spouseRetirementYear =
    client.spouseDob && client.spouseRetirementAge != null
      ? parseInt(client.spouseDob.slice(0, 4), 10) + client.spouseRetirementAge
      : null;
  // "Retirement (Clients)" milestone = the year both have retired (later of the two).
  const retirementYear =
    spouseRetirementYear != null
      ? Math.max(clientRetirementYear, spouseRetirementYear)
      : clientRetirementYear;

  return (
    <EstateTaxTabbedView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
      ownerDobs={ownerDobs}
      retirementYear={retirementYear}
    />
  );
}
