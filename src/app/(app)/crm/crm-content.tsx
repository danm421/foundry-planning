import Link from "next/link";
import { listCrmHouseholds } from "@/lib/crm/households";
import { CrmHouseholdTable, type CrmHouseholdRow } from "@/components/crm-household-table";
import { CrmHouseholdSearch } from "@/components/crm-household-search";

export async function CrmContent({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const rows = await listCrmHouseholds({ search: params.search, status: params.status });

  const households: CrmHouseholdRow[] = rows.map((h) => ({
    id: h.id,
    name: h.name,
    status: h.status,
    contacts: h.contacts.map((c) => ({
      role: c.role,
      firstName: c.firstName,
      lastName: c.lastName,
    })),
    createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : String(h.createdAt),
    updatedAt: h.updatedAt instanceof Date ? h.updatedAt.toISOString() : String(h.updatedAt),
  }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">CRM</h1>
        <Link
          href="/crm/new"
          className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep"
        >
          New Household
        </Link>
      </div>
      <CrmHouseholdSearch />
      <CrmHouseholdTable households={households} />
    </div>
  );
}
