import { and, eq } from "drizzle-orm";
import DetailsShell from "@/components/details-shell";
import DetailsViewModeToggle from "@/components/details-view-mode-toggle";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";

interface ClientDataLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientDataLayout({
  children,
  params,
}: ClientDataLayoutProps) {
  const { id } = await params;
  const firmId = await requireOrgId();

  const [row] = await db
    .select({ viewMode: clients.detailsViewMode })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  const viewMode = row?.viewMode ?? "detailed";

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <DetailsViewModeToggle clientId={id} mode={viewMode} />
      </div>
      <DetailsShell clientId={id}>{children}</DetailsShell>
    </div>
  );
}
