import { Suspense } from "react";
import { getOrgId } from "@/lib/db-helpers";
import { ClientsContent } from "./clients-content";
import ClientsSkeleton from "./loading-skeleton";

export default async function ClientsPage() {
  const firmId = await getOrgId();

  return (
    <Suspense fallback={<ClientsSkeleton />}>
      <ClientsContent firmId={firmId} />
    </Suspense>
  );
}
