import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { TimelineContent } from "./timeline-content";
import TimelineSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TimelineReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const inFirm = await findClientInFirm(id, firmId);
  if (!inFirm) notFound();

  return (
    <Suspense fallback={<TimelineSkeleton />}>
      <TimelineContent id={id} firmId={firmId} />
    </Suspense>
  );
}
