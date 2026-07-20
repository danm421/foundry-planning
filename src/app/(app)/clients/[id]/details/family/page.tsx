import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { FamilyContent } from "./family-content";
import FamilySkeleton from "./loading-skeleton";
import DetailsPageShell from "@/components/details-page-shell";
import DivorcePlanningEntry from "@/components/divorce/divorce-planning-entry";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function FamilyPage({ params, searchParams }: PageProps) {
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
      <Suspense fallback={<FamilySkeleton />}>
        <FamilyContent clientId={id} scenarioParam={sp.scenario} />
      </Suspense>
      {/* Self-contained: renders nothing unless the client files as married and
          the household has a spouse contact. Its own Suspense so its cheap
          probe queries don't block the family view's first paint. */}
      <Suspense fallback={null}>
        <DivorcePlanningEntry clientId={id} />
      </Suspense>
    </DetailsPageShell>
  );
}
