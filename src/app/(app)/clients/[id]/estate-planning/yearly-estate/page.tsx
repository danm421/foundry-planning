import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import YearlyEstateReportView from "@/components/yearly-estate-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function YearlyEstateReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
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

  return (
    <YearlyEstateReportView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
      ownerDobs={ownerDobs}
    />
  );
}
