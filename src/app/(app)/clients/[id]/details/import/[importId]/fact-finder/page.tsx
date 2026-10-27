import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { FactFinderScreen } from "@/components/fact-finder/fact-finder-screen";
import { FinishedImportNotice } from "@/components/fact-finder/finished-import-notice";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { getOrgId } from "@/lib/db-helpers";
import { importScreenPath, isFactFinderImport, isFinishedInStatementChat, isSavedFactFinder } from "@/lib/imports/import-kind";
import { listClientDocuments } from "@/lib/imports/client-documents";
import { listLiveFiles } from "@/lib/fact-finder/persist";
import { readFactFinderState } from "@/lib/fact-finder/state";
import type { ImportPayloadJson } from "@/lib/imports/types";

interface PageProps {
  params: Promise<{ id: string; importId: string }>;
}

/**
 * The fact finder import screen. Loads the import's fact finder, its live
 * files and the client's vault files, and hands them to
 * the client screen — each file's id, name and type, never its storage address.
 * A wizard import goes to the wizard; a statement-chat import finished before
 * the switch shows a notice and loads nothing more.
 */
export default async function FactFinderPage({ params }: PageProps) {
  const { id: clientId, importId } = await params;
  const { firmId } = await requireClientPageAccess(clientId);
  // Imports belong to the firm that owns the client (the fact finder routes
  // refuse anyone else), so a client shared from another firm has none here.
  // A teammate's share inside the same firm does.
  if (firmId !== (await getOrgId())) notFound();

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
  if (isFinishedInStatementChat(imp.status, payloadJson)) {
    return <FinishedImportNotice clientId={clientId} finishedAt={(imp.committedAt ?? imp.updatedAt).toISOString()} />;
  }
  const saved = isSavedFactFinder(payloadJson);

  const [files, clientDocuments] = await Promise.all([
    listLiveFiles(importId),
    // A saved import has no upload box to offer them in.
    saved ? [] : listClientDocuments(clientId, firmId),
  ]);

  return (
    <FactFinderScreen
      clientId={clientId}
      importId={importId}
      initialState={readFactFinderState(payloadJson)}
      initialFiles={files.map((f) => ({ id: f.id, name: f.originalFilename, documentType: f.documentType }))}
      clientDocuments={clientDocuments}
    />
  );
}
