import {
  LoadingLabel,
  SkeletonCard,
  SkeletonChart,
  SkeletonKpi,
  SkeletonTable,
} from "@/components/skeleton";

/**
 * Generic content-area fallback shared by the client section `loading.tsx`
 * route boundaries (top-level tabs at `[id]/`, and each sub-tabbed segment:
 * cashflow / details / assets / estate-planning).
 *
 * Why a route boundary at all: each section page blocks on uncached
 * `requireOrgId()` + `findClientInFirm()` awaits before it returns its own
 * in-page `<Suspense>`. With no boundary, App Router keeps the *previous* page
 * on screen until the server finishes — navigation feels frozen. A
 * `loading.tsx` paints this skeleton the instant a tab is clicked; the page's
 * own tailored skeleton then takes over as it begins to render.
 *
 * Kept deliberately neutral (KPIs → chart → table) so it reads as "a section
 * is loading" for any tab. The surrounding header, tab bar, and sub-tab
 * strips live in layouts above this boundary and stay put.
 */
export default function SectionLoading() {
  return (
    <div className="flex flex-col gap-[var(--gap-grid)]" aria-busy="true">
      <LoadingLabel>Loading…</LoadingLabel>

      <div className="grid grid-cols-2 gap-[var(--gap-grid)] md:grid-cols-3">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>

      <SkeletonChart />

      <SkeletonCard>
        <SkeletonTable rows={5} columns={4} />
      </SkeletonCard>
    </div>
  );
}
