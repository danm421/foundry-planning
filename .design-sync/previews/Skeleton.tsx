import { Skeleton } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="flex flex-col gap-3">
        <Skeleton height="0.75rem" width={220} />
        <Skeleton height="1rem" width={320} />
        <Skeleton height="1.75rem" width={140} radius={8} />
      </div>
    </div>
  );
}

export function Shapes() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="flex items-end gap-4">
        <Skeleton width={48} height={48} radius="9999px" />
        <Skeleton width={96} height={96} radius={12} />
        <Skeleton height="0.875rem" width={200} />
      </div>
    </div>
  );
}
