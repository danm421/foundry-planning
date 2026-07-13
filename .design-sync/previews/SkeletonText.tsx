import { SkeletonText } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 360 }}>
        <SkeletonText />
      </div>
    </div>
  );
}

export function ManyLines() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 360 }}>
        <SkeletonText lines={6} />
      </div>
    </div>
  );
}
