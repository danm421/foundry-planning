import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { clientImports, entities, familyMembers } from "@/db/schema";
import { FactFinderScreen } from "@/components/fact-finder/fact-finder-screen";
import { FinishedImportNotice } from "@/components/fact-finder/finished-import-notice";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { importScreenPath, isFactFinderImport } from "@/lib/imports/import-kind";
import { listClientIntakeUploads } from "@/lib/imports/intake-documents";
import { listLiveFiles } from "@/lib/fact-finder/persist";
import { readFactFinderState } from "@/lib/fact-finder/state";
import type { ImportPayloadJson } from "@/lib/imports/types";

interface PageProps {
  params: Promise<{ id: string; importId: string }>;
}

/**
 * The fact finder import screen. Loads the import's fact finder, its live
 * files, the client's entities and Data Collection uploads, and hands them to
 * the client screen — each file's id, name and type, never its storage address.
 * A wizard import goes to the wizard; a statement-chat import finished before
 * the switch shows a notice and loads nothing more.
 */
export default async function FactFinderPage({ params }: PageProps) {
  const { id: clientId, importId } = await params;
  const { access, firmId } = await requireClientPageAccess(clientId);
  // Imports belong to the firm that owns the client (the fact finder routes
  // refuse anyone else), so a client shared from another firm has none here.
  if (access !== "own") notFound();

  const [imp] = await db
    .select({
      status: clientImports.status,
      payloadJson: clientImports.payloadJson,
      committedAt: clientImports.committedAt,
      updatedAt: clientImports.updatedAt,
    })
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
  if (!isFactFinderImport(payloadJson)) redirect(importScreenPath(clientId, importId, false));
  // Committed without a saved fact finder: finished in statement chat, before the switch.
  const saved = Boolean(payloadJson.factFinder?.closed);
  if (imp.status === "committed" && !saved) {
    return <FinishedImportNotice clientId={clientId} finishedAt={(imp.committedAt ?? imp.updatedAt).toISOString()} />;
  }

  const [files, entityRows, coClient, clientUploads] = await Promise.all([
    listLiveFiles(importId),
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.clientId, clientId))
      .orderBy(asc(entities.name)),
    // The save's own test for "the plan has a co-client": their family member exists (a person ref resolves to it).
    db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "spouse")))
      .limit(1),
    // A saved import has no upload box to offer them in.
    saved ? [] : listClientIntakeUploads(clientId, firmId),
  ]);

  return (
    <FactFinderScreen
      clientId={clientId}
      importId={importId}
      initialState={readFactFinderState(payloadJson)}
      initialFiles={files.map((f) => ({ id: f.id, name: f.originalFilename, documentType: f.documentType }))}
      entities={entityRows}
      hasCoClient={coClient.length > 0}
      clientUploads={clientUploads}
    />
  );
}
