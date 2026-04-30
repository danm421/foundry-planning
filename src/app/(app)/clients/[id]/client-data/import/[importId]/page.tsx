import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import {
  clientImports,
  clientImportFiles,
  clients,
} from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import type { ImportPayloadJson } from "@/lib/imports/types";
import ClientDataPageShell from "@/components/client-data-page-shell";
import ImportFlow from "./import-flow";

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

  const [imp] = await db
    .select()
    .from(clientImports)
    .where(
      and(
        eq(clientImports.id, importId),
        eq(clientImports.clientId, id),
        eq(clientImports.orgId, firmId),
      ),
    );
  if (!imp) notFound();

  // Discarded drafts route back to the list — no flow surface for them.
  if (imp.status === "discarded") {
    redirect(`/clients/${id}/client-data/import`);
  }

  const files = await db
    .select()
    .from(clientImportFiles)
    .where(
      and(
        eq(clientImportFiles.importId, importId),
        isNull(clientImportFiles.deletedAt),
      ),
    )
    .orderBy(asc(clientImportFiles.uploadedAt));

  const payloadJson = imp.payloadJson as ImportPayloadJson | null;

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <ImportFlow
        clientId={id}
        importId={importId}
        mode={imp.mode}
        status={imp.status}
        scenarioId={imp.scenarioId}
        notes={imp.notes}
        files={files.map((f) => ({
          id: f.id,
          originalFilename: f.originalFilename,
          documentType: f.documentType,
          sizeBytes: f.sizeBytes,
          uploadedAt: f.uploadedAt.toISOString(),
        }))}
        payload={payloadJson?.payload ?? null}
        perTabCommittedAt={imp.perTabCommittedAt as Record<string, string> | null}
      />
    </ClientDataPageShell>
  );
}
