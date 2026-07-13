import { SkeletonChart } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 480 }}>
        <SkeletonChart />
      </div>
    </div>
  );
}

export function Wide() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 720 }}>
        <SkeletonChart />
      </div>
    </div>
  );
}
