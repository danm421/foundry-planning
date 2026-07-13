import { SkeletonCard, SkeletonKpi } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 320 }}>
        <SkeletonCard />
      </div>
    </div>
  );
}

export function CustomContent() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 320 }}>
        <SkeletonCard>
          <SkeletonKpi />
        </SkeletonCard>
      </div>
    </div>
  );
}
