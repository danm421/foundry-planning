import { SkeletonKpi } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 220 }}>
        <SkeletonKpi />
      </div>
    </div>
  );
}

export function Row() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="flex gap-4">
        <div style={{ width: 200 }}>
          <SkeletonKpi />
        </div>
        <div style={{ width: 200 }}>
          <SkeletonKpi />
        </div>
        <div style={{ width: 200 }}>
          <SkeletonKpi />
        </div>
      </div>
    </div>
  );
}
