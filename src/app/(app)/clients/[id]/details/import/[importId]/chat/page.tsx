import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { clientImports, clientImportFiles, clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import DetailsPageShell from "@/components/details-page-shell";
import { ChatSurface } from "@/components/statement-chat/chat-surface";
import type { RowsByEntity } from "@/lib/entity-extraction/types";
import { loadChatReviewContext } from "@/lib/statement-chat/review-context";

interface PageProps {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

/**
 * Statement chat's page shell (Task 9). Loads just enough for the client
 * component to take over — already-uploaded files, so a revisit doesn't
 * force a re-upload — and leaves everything about a completed extraction
 * (the placeholder table, the narration) to the SSE round trip the surface
 * drives itself; see chat-surface.tsx.
 *
 * Not split into a `-content.tsx` + `loading-skeleton.tsx` pair the way the
 * sibling import pages are: the brief's file list names only this file for
 * the page layer, and there is little to stream around — the two DB reads
 * below are the whole of this page's own work.
 */
export default async function StatementChatPage({ params, searchParams }: PageProps) {
  const { id: clientId, importId } = await params;
  const sp = await searchParams;
  const firmId = await getOrgId();

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) redirect("/clients");

  const [imp] = await db
    .select({
      id: clientImports.id,
      status: clientImports.status,
      extractHoldings: clientImports.extractHoldings,
      scenarioId: clientImports.scenarioId,
      payloadJson: clientImports.payloadJson,
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

  // A discarded draft has no surface to resume — same rule the ordinary
  // wizard flow uses (import-flow-content.tsx).
  if (imp.status === "discarded") {
    redirect(`/clients/${clientId}/details/import`);
  }

  // The plan this import commits into: who is on the roster (the Owner
  // dropdown), and which accounts already exist (matching). Scoped to the same
  // scenario the commit route resolves, so the candidates offered are the rows
  // the commit can actually update.
  const reviewContext = await loadChatReviewContext(clientId, imp.scenarioId);

  // The map-driven rows a previous visit already extracted (final review I5,
  // Ruling 37). `runMapEntityPass` persists them here and `PATCH /chat/map-pass`
  // stamps the committed ones with `match.existingId` — and until now NOTHING
  // read the column back, so returning to this import showed no policies card
  // and "Re-run extraction" offered a policy that had already been written.
  // Read straight off the payload rather than through another query: it is the
  // same row already fetched above.
  const storedMapRows = (
    ((imp.payloadJson ?? {}) as { chat?: { entityRows?: RowsByEntity } }).chat?.entityRows ?? {}
  ) as RowsByEntity;

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

  return (
    <DetailsPageShell clientId={clientId} scenarioId={sp.scenario}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink">Statement chat</h1>
          <Link
            href={`/clients/${clientId}/details/import`}
            className="text-sm text-ink-3 underline-offset-2 hover:underline"
          >
            ← Back to imports
          </Link>
        </div>
        <ChatSurface
          clientId={clientId}
          importId={importId}
          initialFiles={files.map((f) => ({
            serverFileId: f.id,
            name: f.originalFilename,
            documentType: f.documentType,
          }))}
          initialExtractHoldings={imp.extractHoldings === true}
          reviewContext={reviewContext}
          initialMapRows={storedMapRows}
        />
      </div>
    </DetailsPageShell>
  );
}
