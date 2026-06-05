import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { BalanceSheetReportContent } from "./balance-sheet-report-content";
import BalanceSheetReportSkeleton from "./loading-skeleton";
import BalanceSheetPdfButton from "@/components/balance-sheet-pdf-button";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function BalanceSheetReportPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <BalanceSheetPdfButton clientId={id} />
        </div>
        <Suspense fallback={<BalanceSheetReportSkeleton />}>
          <BalanceSheetReportContent clientId={id} scenarioParam={sp.scenario} />
        </Suspense>
      </div>
    </ScenarioDrawerShell>
  );
}
