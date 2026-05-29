import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { InvestmentsContent } from "./investments-content";
import InvestmentsSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ group?: string }>;
}

export default async function InvestmentsPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id: clientId } = await params;
  const { group } = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) notFound();

  return (
    <Suspense fallback={<InvestmentsSkeleton />}>
      <InvestmentsContent
        clientId={clientId}
        firmId={firmId}
        groupKey={group ?? "all-liquid"}
      />
    </Suspense>
  );
}
