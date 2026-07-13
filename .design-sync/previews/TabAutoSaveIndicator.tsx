import { TabAutoSaveIndicator } from "foundry-planning";

const noop = () => {};

export function Saving() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div
        className="flex items-center justify-between border-b border-hair bg-card px-4 py-2"
        style={{ width: 420 }}
      >
        <span className="text-[13px] font-medium text-ink-2">Beneficiaries</span>
        <TabAutoSaveIndicator saving error={null} onDismissError={noop} />
      </div>
    </div>
  );
}

export function ErrorState() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div
        className="flex items-center justify-between border-b border-hair bg-card px-4 py-2"
        style={{ width: 420 }}
      >
        <span className="text-[13px] font-medium text-ink-2">Beneficiaries</span>
        <TabAutoSaveIndicator
          saving={false}
          error="Save failed — retry"
          onDismissError={noop}
        />
      </div>
    </div>
  );
}
