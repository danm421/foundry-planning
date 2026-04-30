import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import { listClientImports } from "@/lib/imports/list";
import ClientDataPageShell from "@/components/client-data-page-shell";
import DraftsList from "./drafts-list";

interface ImportPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function ImportPage({ params, searchParams }: ImportPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await getOrgId();

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) redirect("/clients");

  const { inProgress, completed } = await listClientImports({
    clientId: id,
    firmId,
  });

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <DraftsList
        clientId={id}
        inProgress={inProgress}
        completed={completed}
      />
    </ClientDataPageShell>
  );
}
