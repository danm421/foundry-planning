import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { clientImports, entities } from "@/db/schema";
import { FactFinderScreen } from "@/components/fact-finder/fact-finder-screen";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { isFactFinderImport } from "@/lib/fact-finder/gate";
import { listLiveFiles } from "@/lib/fact-finder/persist";
import { readFactFinderState } from "@/lib/fact-finder/state";
import type { ImportPayloadJson } from "@/lib/imports/types";

interface PageProps {
  params: Promise<{ id: string; importId: string }>;
}

/**
 * The fact finder import screen. Not linked from anywhere yet. Loads the
 * import's fact finder, its live files and the client's entities, and hands
 * them to the client screen — each file's id, name and type, never its
 * storage address.
 */
export default async function FactFinderPage({ params }: PageProps) {
  const { id: clientId, importId } = await params;
  const { access, firmId } = await requireClientPageAccess(clientId);
  // Imports belong to the firm that owns the client (the fact finder routes
  // refuse anyone else), so a client shared from another firm has none here.
  if (access !== "own") notFound();

  const [imp] = await db
    .select({ status: clientImports.status, payloadJson: clientImports.payloadJson })
    .from(clientImports)
    .where(
      and(
        eq(clientImports.id, importId),
        eq(clientImports.clientId, clientId),
        eq(clientImports.orgId, firmId),
      ),
    );
  if (!imp) notFound();
  if (imp.status === "discarded") redirect(`/clients/${clientId}/details/import`);

  const payloadJson = (imp.payloadJson ?? {}) as ImportPayloadJson;
  if (!isFactFinderImport(payloadJson)) notFound();

  const [files, entityRows] = await Promise.all([
    listLiveFiles(importId),
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.clientId, clientId))
      .orderBy(asc(entities.name)),
  ]);

  return (
    <FactFinderScreen
      clientId={clientId}
      importId={importId}
      initialState={readFactFinderState(payloadJson)}
      initialFiles={files.map((f) => ({ id: f.id, name: f.originalFilename, documentType: f.documentType }))}
      entities={entityRows}
    />
  );
}
