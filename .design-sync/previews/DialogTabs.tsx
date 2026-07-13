import { DialogTabs } from "foundry-planning";
import type { ReactNode } from "react";

const noop = () => {};

function Canvas({ children }: { children: ReactNode }) {
  return <div className="bg-paper text-ink font-sans p-6">{children}</div>;
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{name}</span>
      <span className="tabular text-ink">{value}</span>
    </div>
  );
}

export function Strip() {
  return (
    <Canvas>
      <div className="w-[560px] overflow-hidden rounded-[var(--radius)] border border-hair bg-card">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-ink">Edit account</h2>
        </div>
        <DialogTabs
          tabs={[
            { id: "details", label: "Details" },
            { id: "holdings", label: "Holdings" },
            { id: "beneficiaries", label: "Beneficiaries" },
            { id: "activity", label: "Activity" },
          ]}
          activeTab="holdings"
          onTabChange={noop}
        />
        <div className="space-y-2 px-4 py-4 text-[13px] text-ink-2">
          <Row name="Vanguard Total Stock (VTSAX)" value="$612,400" />
          <Row name="Vanguard Total Bond (VBTLX)" value="$188,900" />
          <Row name="Cash & sweep" value="$14,220" />
        </div>
      </div>
    </Canvas>
  );
}

export function WithStatus() {
  return (
    <Canvas>
      <div className="w-[560px] overflow-hidden rounded-[var(--radius)] border border-hair bg-card">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-ink">Edit household</h2>
        </div>
        <DialogTabs
          tabs={[
            { id: "members", label: "Members" },
            { id: "goals", label: "Goals" },
            { id: "assumptions", label: "Assumptions" },
          ]}
          activeTab="assumptions"
          onTabChange={noop}
          right={
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Saved
            </span>
          }
        />
        <div className="px-4 py-4 text-[13px] text-ink-3">
          Changes to assumptions save automatically as you edit.
        </div>
      </div>
    </Canvas>
  );
}
