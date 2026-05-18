import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import { ImportFlowContent } from "./import-flow-content";
import ImportFlowSkeleton from "./loading-skeleton";
import ClientDataPageShell from "@/components/client-data-page-shell";

interface PageProps {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function ImportFlowPage({ params, searchParams }: PageProps) {
  const { id, importId } = await params;
  const sp = await searchParams;
  const firmId = await getOrgId();

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) redirect("/clients");

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <Suspense fallback={<ImportFlowSkeleton />}>
        <ImportFlowContent clientId={id} importId={importId} scenarioParam={sp.scenario} />
      </Suspense>
    </ClientDataPageShell>
  );
}
