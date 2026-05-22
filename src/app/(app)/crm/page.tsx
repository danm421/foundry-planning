import { Suspense } from "react";
import { CrmContent } from "./crm-content";
import { LoadingSkeleton } from "./loading-skeleton";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <CrmContent searchParams={searchParams} />
    </Suspense>
  );
}
