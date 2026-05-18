import { LoadingLabel, Skeleton } from "@/components/skeleton";

export default function ComparisonTemplatesSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingLabel>Loading Comparison Templates…</LoadingLabel>

      {/* Built-in section */}
      <div className="mt-10">
        <Skeleton height="0.6875rem" width="4rem" className="mb-2" />
        <div className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Skeleton height="0.875rem" width="12rem" />
                <Skeleton height="0.75rem" width="18rem" />
              </div>
              <Skeleton height="2rem" width="5rem" radius="0.375rem" />
            </div>
          ))}
        </div>
      </div>

      {/* Firm templates section */}
      <div className="mt-10">
        <Skeleton height="0.6875rem" width="9rem" className="mb-2" />
        <div className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Skeleton height="0.875rem" width="10rem" />
                <Skeleton height="0.75rem" width="15rem" />
              </div>
              <Skeleton height="2rem" width="5rem" radius="0.375rem" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
