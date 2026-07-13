import { SkeletonTable } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 480 }}>
        <SkeletonTable />
      </div>
    </div>
  );
}

export function WideDense() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 640 }}>
        <SkeletonTable rows={8} columns={6} />
      </div>
    </div>
  );
}
