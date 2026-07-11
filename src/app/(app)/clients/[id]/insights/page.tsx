import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { InsightsContent } from "./insights-content";

export const dynamic = "force-dynamic";

export default async function ClientInsightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const firmId = await getOrgId();
  const { id } = await params;
  if (!(await findClientInFirm(id, firmId))) notFound();

  return (
    <Suspense fallback={<div className="p-6 text-ink-3">Loading 360…</div>}>
      <InsightsContent clientId={id} firmId={firmId} />
    </Suspense>
  );
}
