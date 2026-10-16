import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { loadBalanceSheetReport } from "@/lib/balance-sheet/load-report";
import BalanceSheetReport from "@/components/balance-sheet-report/balance-sheet-report";

interface BalanceSheetReportContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function BalanceSheetReportContent({ clientId: id, scenarioParam }: BalanceSheetReportContentProps) {
  const firmId = await requireOrgId();

  const [clientRow] = await db
    .select({ id: clients.id, crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!clientRow) notFound();

  // Shared with the PDF export (titling, year slimming, spouse gating, trust
  // details, owner labels) so the download matches this page exactly.
  const { report } = await loadBalanceSheetReport(id, firmId, clientRow.crmHouseholdId, scenarioParam);

  return <BalanceSheetReport {...report} todayYear={new Date().getFullYear()} pdfClientId={id} />;
}
