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
import { loadImportGrowthContext } from "@/lib/investments/growth-context";
import { loadImportMilestones } from "@/lib/imports/import-milestones";
import ImportFlow from "./import-flow";

interface ImportFlowContentProps {
  clientId: string;
  importId: string;
}

export async function ImportFlowContent({ clientId: id, importId }: ImportFlowContentProps) {
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
    redirect(`/clients/${id}/details/import`);
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

  const [growthContext, importMilestones] = await Promise.all([
    loadImportGrowthContext(id, firmId, imp.scenarioId),
    loadImportMilestones(id, firmId, imp.scenarioId),
  ]);

  return (
    <ImportFlow
      clientId={id}
      importId={importId}
      mode={imp.mode}
      status={imp.status}
      scenarioId={imp.scenarioId}
      notes={imp.notes}
      growthContext={growthContext}
      files={files.map((f) => ({
        id: f.id,
        originalFilename: f.originalFilename,
        documentType: f.documentType,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.uploadedAt.toISOString(),
      }))}
      payload={payloadJson?.payload ?? null}
      assumptions={payloadJson?.assemble?.assumptions ?? []}
      perTabCommittedAt={imp.perTabCommittedAt as Record<string, string> | null}
      milestones={importMilestones?.milestones ?? null}
      clientFirstName={importMilestones?.clientFirstName}
      spouseFirstName={importMilestones?.spouseFirstName}
    />
  );
}
