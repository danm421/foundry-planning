import { redirect } from "next/navigation";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { importScreenPath } from "@/lib/imports/import-kind";

interface PageProps {
  params: Promise<{ id: string; importId: string }>;
}

/**
 * Statement chat's old address (bookmarks, browser history). Checks client
 * access like every client page, then the fact finder screen does the rest: it
 * sends a wizard import on to the wizard and shows a statement-chat import
 * finished before the switch read-only.
 */
export default async function StatementChatPage({ params }: PageProps) {
  const { id: clientId, importId } = await params;
  await requireClientPageAccess(clientId);
  redirect(importScreenPath(clientId, importId, true));
}
