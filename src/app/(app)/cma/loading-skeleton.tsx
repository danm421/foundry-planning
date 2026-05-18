import { LoadingLabel, Skeleton } from "@/components/skeleton";

export default function CmaSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingLabel>Loading Capital Market Assumptions…</LoadingLabel>

      {/* Tab toggle */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-800/50 p-1">
        <Skeleton height="2.25rem" className="flex-1 rounded-md" />
        <Skeleton height="2.25rem" className="flex-1 rounded-md" />
      </div>

      {/* Asset classes table — styled sticky header + body rows */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <div className="bg-gray-800/60 px-3 py-2">
          <div className="grid grid-cols-10 gap-3">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} height="0.75rem" width="100%" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 p-3" aria-hidden="true">
          {[...Array(8)].map((_, r) => (
            <div key={r} className="grid grid-cols-10 gap-3">
              {[...Array(10)].map((_, c) => (
                <Skeleton key={c} height="1rem" width="100%" />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Add button */}
      <div className="mt-4">
        <Skeleton height="2.25rem" width="9rem" radius="0.375rem" />
      </div>
    </div>
  );
}
