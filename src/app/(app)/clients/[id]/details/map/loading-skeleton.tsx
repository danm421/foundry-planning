import { LoadingLabel, Skeleton } from "@/components/skeleton";

/** One board column: a person node placeholder over a stack of card
 *  placeholders. Mirrors the three-column net-worth board the route renders. */
function SkeletonColumn({ cards }: { cards: number }) {
  return (
    <div className="flex flex-col items-center gap-3" aria-hidden="true">
      <Skeleton height="3rem" width="3rem" radius="9999px" />
      <Skeleton height="0.875rem" width="45%" />
      <div className="flex w-full flex-col gap-2">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} height="2.75rem" className="w-full" radius="0.5rem" />
        ))}
      </div>
    </div>
  );
}

export default function MapLoadingSkeleton() {
  return (
    <div className="rounded-xl border border-hair bg-card p-5" aria-busy="true">
      <LoadingLabel>Loading household map…</LoadingLabel>

      {/* Tab row + net-worth pill */}
      <div className="mb-5 flex items-center justify-between" aria-hidden="true">
        <div className="flex gap-1">
          <Skeleton height="1.75rem" width="5.5rem" radius="0.375rem" />
          <Skeleton height="1.75rem" width="4.5rem" radius="0.375rem" />
          <Skeleton height="1.75rem" width="5.5rem" radius="0.375rem" />
        </div>
        <Skeleton height="1.75rem" width="10rem" radius="0.375rem" />
      </div>

      {/* Client · joint · spouse */}
      <div className="grid grid-cols-3 gap-4">
        <SkeletonColumn cards={3} />
        <SkeletonColumn cards={4} />
        <SkeletonColumn cards={3} />
      </div>

      {/* Tray */}
      <div className="mt-5 border-t border-hair pt-4" aria-hidden="true">
        <Skeleton height="0.75rem" width="6rem" />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Skeleton height="2.75rem" radius="0.5rem" />
          <Skeleton height="2.75rem" radius="0.5rem" />
          <Skeleton height="2.75rem" radius="0.5rem" />
        </div>
      </div>
    </div>
  );
}
