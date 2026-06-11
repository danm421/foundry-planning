import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  listCrmHouseholds,
  listRecentlyOpenedHouseholds,
} from "@/lib/crm/households";
import { CrmHouseholdSearch } from "@/components/crm-household-search";
import { UnifiedClientsTable, type UnifiedClientRow } from "@/components/unified-clients-table";

export async function ClientsContent({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; view?: string }>;
}) {
  const params = await searchParams;
  const { userId, orgRole } = await auth();
  const canManage = orgRole === "org:owner" || orgRole === "org:admin";

  const deletedView = params.view === "deleted";
  // Default to the "Recently opened" view; ?view=all and ?view=deleted opt out.
  const recentView = !deletedView && params.view !== "all";

  const households = deletedView
    ? await listCrmHouseholds({ search: params.search, status: params.status, deleted: true })
    : recentView && userId
      ? await listRecentlyOpenedHouseholds({
          userId,
          search: params.search,
          status: params.status,
        })
      : await listCrmHouseholds({
          search: params.search,
          status: params.status,
        });

  const rows: UnifiedClientRow[] = households.map((h) => {
    const primary = h.contacts.find((c) => c.role === "primary");
    const spouse = h.contacts.find((c) => c.role === "spouse");
    return {
      householdId: h.id,
      name: h.name,
      status: h.status,
      primaryName: primary ? `${primary.firstName} ${primary.lastName}`.trim() : null,
      spouseName: spouse ? `${spouse.firstName} ${spouse.lastName}`.trim() : null,
      hasPlanning: Boolean(h.planningClient),
      planningClientId: h.planningClient?.id ?? null,
      updatedAt: h.updatedAt.toISOString(),
      deletedAt: h.deletedAt ? h.deletedAt.toISOString() : null,
    };
  });

  const tab = "text-sm text-ink-3 hover:text-ink";
  const tabActive = "text-sm font-medium text-ink";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Clients</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/crm/import"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 text-[13px] font-semibold text-ink-2 transition-colors hover:border-hair-2 hover:bg-card-hover hover:text-ink"
          >
            Bulk import
          </Link>
          <Link
            href="/crm/new"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink"
          >
            New household
          </Link>
        </div>
      </div>
      <div className="mt-2 flex gap-4">
        <Link href="/clients" className={recentView ? tabActive : tab}>
          Recently opened
        </Link>
        <Link href="/clients?view=all" className={!recentView && !deletedView ? tabActive : tab}>
          All
        </Link>
        {canManage && (
          <Link href="/clients?view=deleted" className={deletedView ? tabActive : tab}>
            Trash
          </Link>
        )}
      </div>
      <CrmHouseholdSearch />
      <UnifiedClientsTable
        rows={rows}
        canManage={canManage}
        emptyMessage={
          deletedView
            ? "Trash is empty."
            : recentView
              ? "No recently opened clients yet. Open a client's CRM or Planning to see it here."
              : undefined
        }
      />
    </div>
  );
}
