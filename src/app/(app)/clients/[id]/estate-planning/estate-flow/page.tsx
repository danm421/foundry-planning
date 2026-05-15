import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import EstateFlowView from "@/components/estate-flow-view";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function EstateFlowPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const scenarioId = sp.scenario ?? "base";
  const { effectiveTree } = await loadEffectiveTree(id, firmId, scenarioId, {}).catch(() => notFound());

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  return (
    <EstateFlowView
      clientId={id}
      scenarioId={scenarioId}
      isMarried={isMarried}
      ownerNames={{
        clientName: client.firstName ?? "Client",
        spouseName: client.spouseName ?? null,
      }}
      initialClientData={effectiveTree}
    />
  );
}
