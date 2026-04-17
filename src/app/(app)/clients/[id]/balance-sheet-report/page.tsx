import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import BalanceSheetReportView from "@/components/balance-sheet-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BalanceSheetReportPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  return <BalanceSheetReportView clientId={id} />;
}
