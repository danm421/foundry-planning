import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import { listClientImports } from "@/lib/imports/list";
import DraftsList from "./drafts-list";

interface ImportContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function ImportContent({ clientId: id, scenarioParam }: ImportContentProps) {
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
    <DraftsList
      clientId={id}
      inProgress={inProgress}
      completed={completed}
    />
  );
}
