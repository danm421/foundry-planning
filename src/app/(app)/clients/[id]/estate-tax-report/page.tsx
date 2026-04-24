import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import EstateTaxReportView from "@/components/estate-tax-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EstateTaxReportPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  const ownerNames = {
    clientName: client.firstName ?? "Client",
    spouseName: client.spouseName ?? null,
  };

  return (
    <EstateTaxReportView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
    />
  );
}
