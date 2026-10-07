import { Suspense } from "react";
import { MapContent } from "./map-content";
import MapLoadingSkeleton from "./loading-skeleton";
import DetailsPageShell from "@/components/details-page-shell";
import { requireClientPageAccess } from "@/lib/clients/page-access";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function HouseholdMapPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  await requireClientPageAccess(id);
  const { scenario } = await searchParams;
  return (
    <DetailsPageShell clientId={id} scenarioId={scenario}>
      <Suspense fallback={<MapLoadingSkeleton />}>
        <MapContent clientId={id} scenarioParam={scenario} />
      </Suspense>
    </DetailsPageShell>
  );
}
