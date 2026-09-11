import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { clientImports, clientImportFiles, clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import DetailsPageShell from "@/components/details-page-shell";
import { ChatSurface } from "@/components/statement-chat/chat-surface";

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
    .select({ id: clientImports.id, status: clientImports.status })
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
        />
      </div>
    </DetailsPageShell>
  );
}
