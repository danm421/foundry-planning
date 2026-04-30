import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clients, scenarios } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import ClientDataPageShell from "@/components/client-data-page-shell";
import ModePickerClient from "./mode-picker-client";

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

  const scenarioRows = await db
    .select({
      id: scenarios.id,
      name: scenarios.name,
      isBaseCase: scenarios.isBaseCase,
    })
    .from(scenarios)
    .where(eq(scenarios.clientId, id))
    .orderBy(asc(scenarios.isBaseCase), asc(scenarios.name));

  const baseCaseId = scenarioRows.find((s) => s.isBaseCase)?.id ?? null;

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <ModePickerClient
        clientId={id}
        scenarios={scenarioRows}
        defaultScenarioId={baseCaseId}
      />
    </ClientDataPageShell>
  );
}
