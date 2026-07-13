import { SkeletonForm } from "foundry-planning";

export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 360 }}>
        <SkeletonForm />
      </div>
    </div>
  );
}

export function ManyFields() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div style={{ width: 360 }}>
        <SkeletonForm fields={7} />
      </div>
    </div>
  );
}
