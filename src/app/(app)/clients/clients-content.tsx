import Link from "next/link";
import { listCrmHouseholds } from "@/lib/crm/households";
import { CrmHouseholdSearch } from "@/components/crm-household-search";
import { UnifiedClientsTable, type UnifiedClientRow } from "@/components/unified-clients-table";

export async function ClientsContent({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const households = await listCrmHouseholds({
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
    };
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Clients</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/crm/import"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-card"
          >
            Bulk import
          </Link>
          <Link
            href="/crm/new"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep"
          >
            New household
          </Link>
        </div>
      </div>
      <CrmHouseholdSearch />
      <UnifiedClientsTable rows={rows} />
    </div>
  );
}
