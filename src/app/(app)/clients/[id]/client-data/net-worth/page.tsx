import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { NetWorthContent } from "./net-worth-content";
import NetWorthSkeleton from "./loading-skeleton";
import ClientDataPageShell from "@/components/client-data-page-shell";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function BalanceSheetPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <Suspense fallback={<NetWorthSkeleton />}>
        <NetWorthContent clientId={id} scenarioParam={sp.scenario} />
      </Suspense>
    </ClientDataPageShell>
  );
}
