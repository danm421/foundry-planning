import { Suspense } from "react";
import { ClientsContent } from "./clients-content";
import ClientsSkeleton from "./loading-skeleton";

export default function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<ClientsSkeleton />}>
      <ClientsContent searchParams={searchParams} />
    </Suspense>
  );
}
