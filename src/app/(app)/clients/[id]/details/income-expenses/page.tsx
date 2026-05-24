import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { IncomeExpensesContent } from "./income-expenses-content";
import IncomeExpensesSkeleton from "./loading-skeleton";
import DetailsPageShell from "@/components/details-page-shell";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function IncomeExpensesPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  return (
    <DetailsPageShell clientId={id} scenarioId={sp.scenario}>
      <Suspense fallback={<IncomeExpensesSkeleton />}>
        <IncomeExpensesContent clientId={id} scenarioParam={sp.scenario} />
      </Suspense>
    </DetailsPageShell>
  );
}
