import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import { NewImportContent } from "./new-import-content";
import NewImportSkeleton from "./loading-skeleton";
import DetailsPageShell from "@/components/details-page-shell";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function NewImportPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await getOrgId();

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) redirect("/clients");

  return (
    <DetailsPageShell clientId={id} scenarioId={sp.scenario}>
      <Suspense fallback={<NewImportSkeleton />}>
        <NewImportContent clientId={id} />
      </Suspense>
    </DetailsPageShell>
  );
}
