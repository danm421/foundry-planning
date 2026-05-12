import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import StateInheritanceTaxReportView from "@/components/state-inheritance-tax-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InheritanceTaxReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    notFound();
  }

  return <StateInheritanceTaxReportView clientId={id} />;
}
