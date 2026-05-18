import { Suspense } from "react";
import { getOrgId } from "@/lib/db-helpers";
import { TimelineContent } from "./timeline-content";
import TimelineSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TimelineReportPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  return (
    <Suspense fallback={<TimelineSkeleton />}>
      <TimelineContent id={id} firmId={firmId} />
    </Suspense>
  );
}
