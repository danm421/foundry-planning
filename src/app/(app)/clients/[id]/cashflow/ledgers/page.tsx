// src/app/(app)/clients/[id]/cashflow/ledgers/page.tsx
import { redirect } from "next/navigation";

interface LedgersIndexPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

// Ledgers has no landing view of its own — default to the Asset Ledger sub-report,
// preserving any active scenario.
export default async function LedgersIndexPage({ params, searchParams }: LedgersIndexPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = sp.scenario ? `?scenario=${encodeURIComponent(sp.scenario)}` : "";
  redirect(`/clients/${id}/cashflow/ledgers/asset-ledger${qs}`);
}
