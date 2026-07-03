import { LoadingLabel, Skeleton, SkeletonTable } from "@/components/skeleton";

/**
 * Route-boundary fallback for list / index pages (`/tasks`, `/data-collection`).
 * A header row (title + primary action) over a full-width table — matches the
 * `p-6 → <h1> → table` shape those pages render, so real content doesn't jump
 * when it streams in. Rendered in the un-padded app `<main>`, so it carries its
 * own `p-6` to line up with the pages it stands in for.
 */
export default function ListLoading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true">
      <LoadingLabel>Loading…</LoadingLabel>
      <div className="flex items-center justify-between">
        <Skeleton height="1.75rem" width="12rem" />
        <Skeleton height="2.25rem" width="8rem" radius="0.5rem" />
      </div>
      <SkeletonTable rows={8} columns={5} />
    </div>
  );
}
