import { and, eq } from "drizzle-orm";
import DetailsShell from "@/components/details-shell";
import DetailsViewModeToggle from "@/components/details-view-mode-toggle";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientPageAccess } from "@/lib/clients/page-access";

interface ClientDataLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientDataLayout({
  children,
  params,
}: ClientDataLayoutProps) {
  const { id } = await params;
  await requireClientPageAccess(id);
  const firmId = await requireOrgId();

  const [row] = await db
    .select({ viewMode: clients.detailsViewMode })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  const viewMode = row?.viewMode ?? "detailed";

  return (
    // data-fills-viewport gives the app shell a definite height on desktop (see
    // AppLayout), so DetailsShell's two panes scroll on their own instead of
    // the window scrolling both.
    <div data-fills-viewport className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 justify-end">
        <DetailsViewModeToggle clientId={id} mode={viewMode} />
      </div>
      <DetailsShell clientId={id}>{children}</DetailsShell>
    </div>
  );
}
