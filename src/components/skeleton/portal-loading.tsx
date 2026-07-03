import { LoadingLabel, SkeletonCard, SkeletonKpi, SkeletonTable } from "@/components/skeleton";

/**
 * Route-boundary fallback for the client portal. Renders in place of the page
 * *inside* `portal/layout` (which keeps the desktop nav rail / mobile tab bar),
 * skeletoning only the main content: a summary KPI row over a card'd list — a
 * neutral shape that reads as "a portal page is loading" for accounts /
 * transactions / budget / investments / profile.
 */
export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-[var(--gap-grid)] p-4" aria-busy="true">
      <LoadingLabel>Loading…</LoadingLabel>
      <div className="grid grid-cols-2 gap-[var(--gap-grid)] sm:grid-cols-3">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>
      <SkeletonCard>
        <SkeletonTable rows={6} columns={4} />
      </SkeletonCard>
    </div>
  );
}
