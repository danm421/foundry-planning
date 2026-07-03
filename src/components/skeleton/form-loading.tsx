import { LoadingLabel, SkeletonCard, SkeletonForm } from "@/components/skeleton";

/**
 * Route-boundary fallback for the settings section. Renders in place of the
 * page *inside* `settings/layout` (which keeps the settings tab strip on
 * screen), so it only skeletons the content area: a card of form fields, the
 * shape every settings page shares. No outer padding — the layout already pads.
 */
export default function FormLoading() {
  return (
    <div aria-busy="true">
      <LoadingLabel>Loading…</LoadingLabel>
      <SkeletonCard>
        <SkeletonForm fields={5} />
      </SkeletonCard>
    </div>
  );
}
